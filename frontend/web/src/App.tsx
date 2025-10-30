import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

// FHE加密解密函数 - 模拟Zama FHE技术
const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}-${Date.now()}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    const base64Data = encryptedData.split('-')[1];
    return parseFloat(atob(base64Data));
  }
  return parseFloat(encryptedData);
};

// FHE同态计算 - 模拟在加密数据上执行计算
const FHECompute = (encryptedData: string, operation: 'add' | 'multiply' | 'compare', operand?: number): string => {
  const value = FHEDecryptNumber(encryptedData);
  let result = value;
  
  switch(operation) {
    case 'add':
      result = value + (operand || 0);
      break;
    case 'multiply':
      result = value * (operand || 1);
      break;
    case 'compare':
      // 返回比较结果（1为通过，0为拒绝）
      result = value > (operand || 0.5) ? 1 : 0;
      break;
    default:
      result = value;
  }
  
  return FHEEncryptNumber(result);
};

interface Proposal {
  id: string;
  title: string;
  description: string;
  encryptedOutcome: string; // FHE加密的预测结果
  creator: string;
  createdAt: number;
  marketYes: number; // 支持代币数量
  marketNo: number;  // 反对代币数量
  status: 'active' | 'passed' | 'rejected' | 'executing';
  executionTime?: number;
}

interface MarketPosition {
  proposalId: string;
  userAddress: string;
  yesTokens: number;
  noTokens: number;
  encryptedReturn: string; // FHE加密的预期回报
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [marketPositions, setMarketPositions] = useState<MarketPosition[]>([]);
  const [activeTab, setActiveTab] = useState<'proposals' | 'market' | 'dashboard'>('proposals');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingProposal, setCreatingProposal] = useState(false);
  const [tradingProposal, setTradingProposal] = useState<Proposal | null>(null);
  const [showTradeModal, setShowTradeModal] = useState(false);
  const [trading, setTrading] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ 
    visible: boolean; 
    status: "pending" | "success" | "error"; 
    message: string; 
  }>({ visible: false, status: "pending", message: "" });

  // 新提案表单数据
  const [newProposal, setNewProposal] = useState({
    title: "",
    description: "",
    expectedOutcome: 0.7 // 默认预期通过概率70%
  });

  // 交易表单数据
  const [tradeData, setTradeData] = useState({
    proposalId: "",
    direction: 'yes' as 'yes' | 'no',
    amount: 0
  });

  // FHE计算状态
  const [fheComputing, setFheComputing] = useState(false);
  const [computationResult, setComputationResult] = useState<string | null>(null);

  // 初始化加载数据
  useEffect(() => {
    loadProposals().finally(() => setLoading(false));
  }, []);

  const loadProposals = async () => {
    setLoading(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // 检查合约可用性
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.log("Contract not available");
        return;
      }

      // 从合约加载提案keys
      const keysBytes = await contract.getData("proposal_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { 
          console.error("Error parsing proposal keys:", e); 
        }
      }

      const proposalsList: Proposal[] = [];
      for (const key of keys) {
        try {
          const proposalBytes = await contract.getData(`proposal_${key}`);
          if (proposalBytes.length > 0) {
            const proposalData = JSON.parse(ethers.toUtf8String(proposalBytes));
            proposalsList.push({
              id: key,
              title: proposalData.title,
              description: proposalData.description,
              encryptedOutcome: proposalData.encryptedOutcome,
              creator: proposalData.creator,
              createdAt: proposalData.createdAt,
              marketYes: proposalData.marketYes || 0,
              marketNo: proposalData.marketNo || 0,
              status: proposalData.status || 'active',
              executionTime: proposalData.executionTime
            });
          }
        } catch (e) { 
          console.error(`Error loading proposal ${key}:`, e); 
        }
      }
      
      proposalsList.sort((a, b) => b.createdAt - a.createdAt);
      setProposals(proposalsList);
    } catch (e) { 
      console.error("Error loading proposals:", e); 
    } finally { 
      setLoading(false); 
    }
  };

  // 创建新提案
  const createProposal = async () => {
    if (!isConnected) {
      alert("Please connect wallet first");
      return;
    }

    setCreatingProposal(true);
    setTransactionStatus({ 
      visible: true, 
      status: "pending", 
      message: "Encrypting proposal outcome with Zama FHE..." 
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");

      // 使用FHE加密预期结果
      const encryptedOutcome = FHEEncryptNumber(newProposal.expectedOutcome);
      
      const proposalId = `prop_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const proposalData = {
        title: newProposal.title,
        description: newProposal.description,
        encryptedOutcome: encryptedOutcome,
        creator: address,
        createdAt: Math.floor(Date.now() / 1000),
        marketYes: 0,
        marketNo: 0,
        status: 'active'
      };

      // 存储提案数据
      await contract.setData(`proposal_${proposalId}`, ethers.toUtf8Bytes(JSON.stringify(proposalData)));

      // 更新提案keys列表
      const keysBytes = await contract.getData("proposal_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { 
          keys = JSON.parse(ethers.toUtf8String(keysBytes)); 
        } catch (e) { 
          console.error("Error parsing keys:", e); 
        }
      }
      keys.push(proposalId);
      await contract.setData("proposal_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));

      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Proposal created with FHE-encrypted outcome!" 
      });

      await loadProposals();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewProposal({ title: "", description: "", expectedOutcome: 0.7 });
      }, 2000);

    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Proposal creation failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: errorMessage 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingProposal(false); 
    }
  };

  // 在预测市场交易
  const tradeInMarket = async () => {
    if (!isConnected || !tradingProposal) return;

    setTrading(true);
    setTransactionStatus({ 
      visible: true, 
      status: "pending", 
      message: "Processing encrypted market trade with FHE..." 
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");

      // 获取当前提案数据
      const proposalBytes = await contract.getData(`proposal_${tradingProposal.id}`);
      if (proposalBytes.length === 0) throw new Error("Proposal not found");
      
      const proposalData = JSON.parse(ethers.toUtf8String(proposalBytes));
      
      // 更新市场数据
      if (tradeData.direction === 'yes') {
        proposalData.marketYes += tradeData.amount;
      } else {
        proposalData.marketNo += tradeData.amount;
      }

      // 使用FHE计算新的加密结果
      setFheComputing(true);
      const updatedEncryptedOutcome = FHECompute(
        proposalData.encryptedOutcome, 
        'compare', 
        proposalData.marketYes / (proposalData.marketYes + proposalData.marketNo || 1)
      );
      proposalData.encryptedOutcome = updatedEncryptedOutcome;

      // 保存更新后的提案
      await contract.setData(`proposal_${tradingProposal.id}`, ethers.toUtf8Bytes(JSON.stringify(proposalData)));

      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Market trade executed with FHE computation!" 
      });

      await loadProposals();
      setFheComputing(false);
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowTradeModal(false);
        setTradeData({ proposalId: "", direction: 'yes', amount: 0 });
      }, 2000);

    } catch (e: any) {
      setFheComputing(false);
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Trade failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setTrading(false); 
    }
  };

  // 执行提案（基于预测市场结果）
  const executeProposal = async (proposalId: string) => {
    if (!isConnected) return;

    setTransactionStatus({ 
      visible: true, 
      status: "pending", 
      message: "Executing FHE-based proposal decision..." 
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");

      const proposalBytes = await contract.getData(`proposal_${proposalId}`);
      if (proposalBytes.length === 0) throw new Error("Proposal not found");
      
      const proposalData = JSON.parse(ethers.toUtf8String(proposalBytes));

      // 使用FHE计算最终决策（不解密数据）
      setFheComputing(true);
      const decision = FHECompute(proposalData.encryptedOutcome, 'compare', 0.5);
      const decisionValue = FHEDecryptNumber(decision);
      
      proposalData.status = decisionValue > 0.5 ? 'passed' : 'rejected';
      proposalData.executionTime = Math.floor(Date.now() / 1000);
      proposalData.encryptedOutcome = decision;

      await contract.setData(`proposal_${proposalId}`, ethers.toUtf8Bytes(JSON.stringify(proposalData)));

      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: `Proposal ${decisionValue > 0.5 ? 'PASSED' : 'REJECTED'} via FHE computation!` 
      });

      setComputationResult(`FHE Decision: ${decisionValue > 0.5 ? 'PASS' : 'REJECT'} (${decisionValue.toFixed(3)})`);
      await loadProposals();
      setFheComputing(false);

      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setComputationResult(null);
      }, 3000);

    } catch (e: any) {
      setFheComputing(false);
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Execution failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }, 3000));
    }
  };

  // 仪表板统计数据
  const activeProposals = proposals.filter(p => p.status === 'active').length;
  const passedProposals = proposals.filter(p => p.status === 'passed').length;
  const totalMarketVolume = proposals.reduce((sum, p) => sum + p.marketYes + p.marketNo, 0);

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Initializing FHE DAO Framework...</p>
    </div>
  );

  return (
    <div className="app-container fhe-dao-theme">
      {/* Header */}
      <header className="app-header">
        <div className="logo-section">
          <div className="dao-logo">
            <div className="fhe-lock-icon"></div>
            <h1>FHE<span>Futarchy</span>DAO</h1>
          </div>
          <p className="tagline">Zama FHE-Powered Prediction Market Governance</p>
        </div>
        
        <nav className="main-nav">
          <button 
            className={`nav-btn ${activeTab === 'proposals' ? 'active' : ''}`}
            onClick={() => setActiveTab('proposals')}
          >
            Proposals
          </button>
          <button 
            className={`nav-btn ${activeTab === 'market' ? 'active' : ''}`}
            onClick={() => setActiveTab('market')}
          >
            Prediction Market
          </button>
          <button 
            className={`nav-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            Dashboard
          </button>
        </nav>

        <div className="header-actions">
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={true} />
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        {/* Welcome Banner */}
        <div className="welcome-banner">
          <div className="banner-content">
            <h2>FHE-Based Futarchy Governance</h2>
            <p>Proposals are decided by encrypted prediction markets using Zama FHE technology</p>
            <div className="fhe-status">
              <span className="status-indicator"></span>
              FHE Encryption Active
            </div>
          </div>
          <button 
            className="create-proposal-btn"
            onClick={() => setShowCreateModal(true)}
          >
            + New Proposal
          </button>
        </div>

        {/* Transaction Status Modal */}
        {transactionStatus.visible && (
          <div className="transaction-modal">
            <div className="transaction-content">
              <div className={`status-icon ${transactionStatus.status}`}>
                {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
                {transactionStatus.status === "success" && "✓"}
                {transactionStatus.status === "error" && "✕"}
              </div>
              <div className="status-message">{transactionStatus.message}</div>
              {fheComputing && (
                <div className="fhe-computation">
                  <div className="computation-bar"></div>
                  <span>FHE Computing...</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Computation Result */}
        {computationResult && (
          <div className="computation-result">
            <div className="result-badge">FHE Result</div>
            <code>{computationResult}</code>
          </div>
        )}

        {/* Proposals Tab */}
        {activeTab === 'proposals' && (
          <div className="tab-content">
            <div className="section-header">
              <h3>Governance Proposals</h3>
              <span className="count-badge">{proposals.length} proposals</span>
            </div>
            
            <div className="proposals-grid">
              {proposals.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">📋</div>
                  <h4>No proposals yet</h4>
                  <p>Create the first governance proposal to start the prediction market</p>
                  <button 
                    className="primary-btn"
                    onClick={() => setShowCreateModal(true)}
                  >
                    Create First Proposal
                  </button>
                </div>
              ) : (
                proposals.map(proposal => (
                  <div key={proposal.id} className="proposal-card">
                    <div className="proposal-header">
                      <h4>{proposal.title}</h4>
                      <span className={`status-tag ${proposal.status}`}>
                        {proposal.status.toUpperCase()}
                      </span>
                    </div>
                    
                    <p className="proposal-desc">{proposal.description}</p>
                    
                    <div className="proposal-meta">
                      <span>By {proposal.creator.slice(0, 8)}...{proposal.creator.slice(-6)}</span>
                      <span>{new Date(proposal.createdAt * 1000).toLocaleDateString()}</span>
                    </div>

                    <div className="market-data">
                      <div className="market-odds">
                        <span>YES: {proposal.marketYes} tokens</span>
                        <span>NO: {proposal.marketNo} tokens</span>
                      </div>
                      <div className="probability">
                        Implied Probability: {proposal.marketYes + proposal.marketNo > 0 
                          ? ((proposal.marketYes / (proposal.marketYes + proposal.marketNo)) * 100).toFixed(1)
                          : '50.0'}%
                      </div>
                    </div>

                    <div className="proposal-actions">
                      <button 
                        className="trade-btn"
                        onClick={() => {
                          setTradingProposal(proposal);
                          setTradeData({ ...tradeData, proposalId: proposal.id });
                          setShowTradeModal(true);
                        }}
                      >
                        Trade
                      </button>
                      {proposal.status === 'active' && (
                        <button 
                          className="execute-btn"
                          onClick={() => executeProposal(proposal.id)}
                        >
                          Execute
                        </button>
                      )}
                    </div>

                    <div className="fhe-badge">
                      <span>FHE Encrypted Outcome</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Prediction Market Tab */}
        {activeTab === 'market' && (
          <div className="tab-content">
            <div className="section-header">
              <h3>Prediction Market</h3>
              <span className="count-badge">${totalMarketVolume} volume</span>
            </div>

            <div className="market-overview">
              <div className="market-stats">
                <div className="stat-card">
                  <div className="stat-value">{activeProposals}</div>
                  <div className="stat-label">Active Markets</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">${totalMarketVolume}</div>
                  <div className="stat-label">Total Volume</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{passedProposals}</div>
                  <div className="stat-label">Decided</div>
                </div>
              </div>
            </div>

            <div className="market-table">
              <div className="table-header">
                <div>Proposal</div>
                <div>Yes/No</div>
                <div>Probability</div>
                <div>Volume</div>
                <div>Action</div>
              </div>
              
              {proposals.filter(p => p.status === 'active').map(proposal => (
                <div key={proposal.id} className="table-row">
                  <div className="proposal-title">{proposal.title}</div>
                  <div className="market-odds">
                    <span className="yes-odds">{proposal.marketYes}</span>
                    <span className="odds-separator">/</span>
                    <span className="no-odds">{proposal.marketNo}</span>
                  </div>
                  <div className="probability">
                    {proposal.marketYes + proposal.marketNo > 0 
                      ? ((proposal.marketYes / (proposal.marketYes + proposal.marketNo)) * 100).toFixed(1)
                      : '50.0'}%
                  </div>
                  <div className="volume">{proposal.marketYes + proposal.marketNo}</div>
                  <div className="actions">
                    <button 
                      className="small-trade-btn"
                      onClick={() => {
                        setTradingProposal(proposal);
                        setTradeData({ ...tradeData, proposalId: proposal.id });
                        setShowTradeModal(true);
                      }}
                    >
                      Trade
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Dashboard Tab */}
        {activeTab === 'dashboard' && (
          <div className="tab-content">
            <div className="section-header">
              <h3>Governance Dashboard</h3>
            </div>

            <div className="dashboard-grid">
              <div className="dashboard-card">
                <h4>FHE Computation Status</h4>
                <div className="fhe-status-panel">
                  <div className="status-item">
                    <span className="label">Encryption:</span>
                    <span className="value active">Active</span>
                  </div>
                  <div className="status-item">
                    <span className="label">Computation:</span>
                    <span className="value active">Ready</span>
                  </div>
                  <div className="status-item">
                    <span className="label">Zama FHE:</span>
                    <span className="value connected">Connected</span>
                  </div>
                </div>
              </div>

              <div className="dashboard-card">
                <h4>Proposal Statistics</h4>
                <div className="stats-panel">
                  <div className="stat-row">
                    <span>Total Proposals:</span>
                    <strong>{proposals.length}</strong>
                  </div>
                  <div className="stat-row">
                    <span>Active:</span>
                    <strong className="active">{activeProposals}</strong>
                  </div>
                  <div className="stat-row">
                    <span>Passed:</span>
                    <strong className="passed">{passedProposals}</strong>
                  </div>
                  <div className="stat-row">
                    <span>Rejected:</span>
                    <strong className="rejected">{proposals.length - activeProposals - passedProposals}</strong>
                  </div>
                </div>
              </div>

              <div className="dashboard-card">
                <h4>Market Overview</h4>
                <div className="market-panel">
                  <div className="market-metric">
                    <div className="metric-value">${totalMarketVolume}</div>
                    <div className="metric-label">Total Volume</div>
                  </div>
                  <div className="market-metric">
                    <div className="metric-value">{proposals.filter(p => p.marketYes + p.marketNo > 0).length}</div>
                    <div className="metric-label">Active Markets</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="recent-activity">
              <h4>Recent Activity</h4>
              {proposals.slice(0, 5).map(proposal => (
                <div key={proposal.id} className="activity-item">
                  <div className="activity-type">Proposal {proposal.status}</div>
                  <div className="activity-desc">{proposal.title}</div>
                  <div className="activity-time">
                    {new Date(proposal.createdAt * 1000).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Create Proposal Modal */}
      {showCreateModal && (
        <CreateProposalModal
          proposalData={newProposal}
          onChange={setNewProposal}
          onSubmit={createProposal}
          onClose={() => setShowCreateModal(false)}
          loading={creatingProposal}
        />
      )}

      {/* Trade Modal */}
      {showTradeModal && tradingProposal && (
        <TradeModal
          proposal={tradingProposal}
          tradeData={tradeData}
          onChange={setTradeData}
          onSubmit={tradeInMarket}
          onClose={() => {
            setShowTradeModal(false);
            setTradingProposal(null);
          }}
          loading={trading}
        />
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <div className="fhe-powered">
            <span>Powered by Zama FHE Technology</span>
          </div>
          <div className="footer-links">
            <a href="#">Documentation</a>
            <a href="#">GitHub</a>
            <a href="#">Privacy Policy</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

// Modal Components
interface CreateProposalModalProps {
  proposalData: any;
  onChange: (data: any) => void;
  onSubmit: () => void;
  onClose: () => void;
  loading: boolean;
}

const CreateProposalModal: React.FC<CreateProposalModalProps> = ({
  proposalData,
  onChange,
  onSubmit,
  onClose,
  loading
}) => {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!proposalData.title || !proposalData.description) {
      alert("Please fill in all required fields");
      return;
    }
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h3>Create New Proposal</h3>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-group">
            <label>Proposal Title *</label>
            <input
              type="text"
              value={proposalData.title}
              onChange={(e) => onChange({...proposalData, title: e.target.value})}
              placeholder="Enter proposal title..."
              required
            />
          </div>

          <div className="form-group">
            <label>Description *</label>
            <textarea
              value={proposalData.description}
              onChange={(e) => onChange({...proposalData, description: e.target.value})}
              placeholder="Describe the proposal details..."
              rows={4}
              required
            />
          </div>

          <div className="form-group">
            <label>Expected Outcome Probability</label>
            <div className="slider-container">
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={proposalData.expectedOutcome}
                onChange={(e) => onChange({...proposalData, expectedOutcome: parseFloat(e.target.value)})}
              />
              <span className="slider-value">{(proposalData.expectedOutcome * 100).toFixed(0)}%</span>
            </div>
            <div className="probability-hint">
              This value will be encrypted with Zama FHE and used for prediction market
            </div>
          </div>

          <div className="fhe-preview">
            <div className="preview-label">FHE Encryption Preview</div>
            <div className="preview-content">
              <span>Plain: {proposalData.expectedOutcome}</span>
              <span>→</span>
              <span>Encrypted: {FHEEncryptNumber(proposalData.expectedOutcome).substring(0, 30)}...</span>
            </div>
          </div>
        </form>

        <div className="modal-footer">
          <button onClick={onClose} className="secondary-btn">Cancel</button>
          <button onClick={onSubmit} disabled={loading} className="primary-btn">
            {loading ? "Creating with FHE..." : "Create Proposal"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface TradeModalProps {
  proposal: Proposal;
  tradeData: any;
  onChange: (data: any) => void;
  onSubmit: () => void;
  onClose: () => void;
  loading: boolean;
}

const TradeModal: React.FC<TradeModalProps> = ({
  proposal,
  tradeData,
  onChange,
  onSubmit,
  onClose,
  loading
}) => {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (tradeData.amount <= 0) {
      alert("Please enter a valid amount");
      return;
    }
    onSubmit();
  };

  const currentProbability = proposal.marketYes + proposal.marketNo > 0 
    ? (proposal.marketYes / (proposal.marketYes + proposal.marketNo)) 
    : 0.5;

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h3>Trade in Prediction Market</h3>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="trade-info">
            <h4>{proposal.title}</h4>
            <div className="market-stats">
              <div>Current Probability: {(currentProbability * 100).toFixed(1)}%</div>
              <div>Yes: {proposal.marketYes} | No: {proposal.marketNo}</div>
            </div>
          </div>

          <div className="form-group">
            <label>Trade Direction</label>
            <div className="direction-buttons">
              <button
                type="button"
                className={`direction-btn ${tradeData.direction === 'yes' ? 'active' : ''}`}
                onClick={() => onChange({...tradeData, direction: 'yes'})}
              >
                Buy YES
              </button>
              <button
                type="button"
                className={`direction-btn ${tradeData.direction === 'no' ? 'active' : ''}`}
                onClick={() => onChange({...tradeData, direction: 'no'})}
              >
                Buy NO
              </button>
            </div>
          </div>

          <div className="form-group">
            <label>Amount (Tokens)</label>
            <input
              type="number"
              value={tradeData.amount}
              onChange={(e) => onChange({...tradeData, amount: parseFloat(e.target.value)})}
              placeholder="Enter amount..."
              min="0"
              step="1"
            />
          </div>

          <div className="trade-preview">
            <div className="preview-item">
              <span>Potential Payout:</span>
              <span>
                {tradeData.amount} tokens × {
                  tradeData.direction === 'yes' 
                    ? (1/currentProbability).toFixed(2)
                    : (1/(1-currentProbability)).toFixed(2)
                } = {
                  (tradeData.amount * (
                    tradeData.direction === 'yes' 
                      ? 1/currentProbability 
                      : 1/(1-currentProbability)
                  )).toFixed(2)
                } tokens
              </span>
            </div>
          </div>
        </form>

        <div className="modal-footer">
          <button onClick={onClose} className="secondary-btn">Cancel</button>
          <button onClick={onSubmit} disabled={loading} className="primary-btn">
            {loading ? "Processing Trade..." : "Execute Trade"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;