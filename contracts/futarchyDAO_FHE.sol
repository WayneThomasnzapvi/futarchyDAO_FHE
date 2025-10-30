pragma solidity ^0.8.24;
import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract FutarchyDAOGovernanceFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public isProvider;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;
    bool public paused;
    uint256 public cooldownSeconds;
    uint256 public currentBatchId;
    bool public batchOpen;

    struct Proposal {
        euint32 encryptedProposalId;
        euint32 encryptedTargetValue;
        euint32 encryptedMarketPrediction;
    }
    mapping(uint256 => Proposal) public proposals; // batchId -> Proposal

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchClosed();
    error ReplayAttempt();
    error StateMismatch();
    error InvalidBatchId();
    error ProposalNotInitialized();

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event Paused(address account);
    event Unpaused(address account);
    event CooldownSet(uint256 oldCooldownSeconds, uint256 newCooldownSeconds);
    event BatchOpened(uint256 batchId);
    event BatchClosed(uint256 batchId);
    event ProposalSubmitted(uint256 indexed batchId, address indexed provider);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint256 proposalId, uint256 targetValue, uint256 marketPrediction, bool governanceDecision);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier respectCooldown() {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    modifier respectDecryptionCooldown() {
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        isProvider[msg.sender] = true;
        emit ProviderAdded(msg.sender);
        cooldownSeconds = 60; // Default 1 minute cooldown
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        if (!isProvider[provider]) {
            isProvider[provider] = true;
            emit ProviderAdded(provider);
        }
    }

    function removeProvider(address provider) external onlyOwner {
        if (isProvider[provider]) {
            isProvider[provider] = false;
            emit ProviderRemoved(provider);
        }
    }

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function setCooldownSeconds(uint256 newCooldownSeconds) external onlyOwner {
        uint256 oldCooldownSeconds = cooldownSeconds;
        cooldownSeconds = newCooldownSeconds;
        emit CooldownSet(oldCooldownSeconds, newCooldownSeconds);
    }

    function openBatch() external onlyOwner whenNotPaused {
        currentBatchId++;
        batchOpen = true;
        emit BatchOpened(currentBatchId);
    }

    function closeBatch() external onlyOwner whenNotPaused {
        batchOpen = false;
        emit BatchClosed(currentBatchId);
    }

    function submitProposal(
        euint32 encryptedProposalId,
        euint32 encryptedTargetValue,
        euint32 encryptedMarketPrediction
    ) external onlyProvider whenNotPaused respectCooldown {
        if (!batchOpen) revert BatchClosed();

        lastSubmissionTime[msg.sender] = block.timestamp;

        _initIfNeeded(encryptedProposalId);
        _initIfNeeded(encryptedTargetValue);
        _initIfNeeded(encryptedMarketPrediction);

        proposals[currentBatchId] = Proposal({
            encryptedProposalId: encryptedProposalId,
            encryptedTargetValue: encryptedTargetValue,
            encryptedMarketPrediction: encryptedMarketPrediction
        });
        emit ProposalSubmitted(currentBatchId, msg.sender);
    }

    function requestGovernanceDecision(uint256 batchId) external onlyProvider whenNotPaused respectDecryptionCooldown {
        if (batchId != currentBatchId) revert InvalidBatchId();
        if (!_isProposalInitialized(batchId)) revert ProposalNotInitialized();

        lastDecryptionRequestTime[msg.sender] = block.timestamp;

        Proposal storage p = proposals[batchId];
        euint32[] memory ctsArray = new euint32[](3);
        ctsArray[0] = p.encryptedProposalId;
        ctsArray[1] = p.encryptedTargetValue;
        ctsArray[2] = p.encryptedMarketPrediction;

        bytes32 stateHash = _hashCiphertexts(ctsArray);
        uint256 requestId = FHE.requestDecryption(ctsArray, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({
            batchId: batchId,
            stateHash: stateHash,
            processed: false
        });
        emit DecryptionRequested(requestId, batchId);
    }

    function myCallback(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        if (decryptionContexts[requestId].processed) revert ReplayAttempt();
        // Security: Replay protection ensures this callback is processed only once.

        DecryptionContext memory ctx = decryptionContexts[requestId];
        uint256 batchId = ctx.batchId;

        // Security: Rebuild ciphertexts from current storage in the exact same order
        // and re-calculate the state hash. This verifies that the contract state
        // related to these ciphertexts has not changed since the decryption was requested.
        Proposal storage p = proposals[batchId];
        euint32[] memory currentCts = new euint32[](3);
        currentCts[0] = p.encryptedProposalId;
        currentCts[1] = p.encryptedTargetValue;
        currentCts[2] = p.encryptedMarketPrediction;
        bytes32 currentStateHash = _hashCiphertexts(currentCts);

        if (currentStateHash != ctx.stateHash) revert StateMismatch();

        FHE.checkSignatures(requestId, cleartexts, proof);

        (uint256 proposalId, uint256 targetValue, uint256 marketPrediction) = abi.decode(cleartexts, (uint256, uint256, uint256));
        bool governanceDecision = marketPrediction >= targetValue;

        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, batchId, proposalId, targetValue, marketPrediction, governanceDecision);
    }

    function _hashCiphertexts(euint32[] memory cts) internal pure returns (bytes32) {
        bytes32[3] memory ctsAsBytes32;
        for (uint i = 0; i < cts.length; i++) {
            ctsAsBytes32[i] = FHE.toBytes32(cts[i]);
        }
        return keccak256(abi.encode(ctsAsBytes32, address(this)));
    }

    function _initIfNeeded(euint32 val) internal {
        if (!FHE.isInitialized(val)) {
            FHE.asEuint32(0); // Initialize if not already
        }
    }

    function _isProposalInitialized(uint256 batchId) internal view returns (bool) {
        Proposal storage p = proposals[batchId];
        return FHE.isInitialized(p.encryptedProposalId) &&
               FHE.isInitialized(p.encryptedTargetValue) &&
               FHE.isInitialized(p.encryptedMarketPrediction);
    }
}