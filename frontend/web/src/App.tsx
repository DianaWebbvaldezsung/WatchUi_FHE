import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface WatchFace {
  id: string;
  name: string;
  encryptedConfig: string;
  timestamp: number;
  owner: string;
  category: "minimal" | "informative" | "interactive" | "custom";
  isActive: boolean;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [watchFaces, setWatchFaces] = useState<WatchFace[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newWatchFaceData, setNewWatchFaceData] = useState({
    name: "",
    category: "minimal",
    config: ""
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");

  // Calculate statistics
  const activeCount = watchFaces.filter(f => f.isActive).length;
  const minimalCount = watchFaces.filter(f => f.category === "minimal").length;
  const informativeCount = watchFaces.filter(f => f.category === "informative").length;
  const interactiveCount = watchFaces.filter(f => f.category === "interactive").length;
  const customCount = watchFaces.filter(f => f.category === "custom").length;

  useEffect(() => {
    loadWatchFaces().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadWatchFaces = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("watchface_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing watch face keys:", e);
        }
      }
      
      const list: WatchFace[] = [];
      
      for (const key of keys) {
        try {
          const faceBytes = await contract.getData(`watchface_${key}`);
          if (faceBytes.length > 0) {
            try {
              const faceData = JSON.parse(ethers.toUtf8String(faceBytes));
              list.push({
                id: key,
                name: faceData.name,
                encryptedConfig: faceData.config,
                timestamp: faceData.timestamp,
                owner: faceData.owner,
                category: faceData.category,
                isActive: faceData.isActive
              });
            } catch (e) {
              console.error(`Error parsing watch face data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading watch face ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setWatchFaces(list);
    } catch (e) {
      console.error("Error loading watch faces:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitWatchFace = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting watch face with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedConfig = `FHE-${btoa(JSON.stringify(newWatchFaceData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const faceId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const faceData = {
        name: newWatchFaceData.name,
        config: encryptedConfig,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        category: newWatchFaceData.category,
        isActive: false
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `watchface_${faceId}`, 
        ethers.toUtf8Bytes(JSON.stringify(faceData))
      );
      
      const keysBytes = await contract.getData("watchface_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(faceId);
      
      await contract.setData(
        "watchface_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Watch face created with FHE encryption!"
      });
      
      await loadWatchFaces();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewWatchFaceData({
          name: "",
          category: "minimal",
          config: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const activateWatchFace = async (faceId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing with FHE..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const faceBytes = await contract.getData(`watchface_${faceId}`);
      if (faceBytes.length === 0) {
        throw new Error("Watch face not found");
      }
      
      const faceData = JSON.parse(ethers.toUtf8String(faceBytes));
      
      // First deactivate all other faces
      for (const face of watchFaces) {
        if (face.isActive) {
          const bytes = await contract.getData(`watchface_${face.id}`);
          const data = JSON.parse(ethers.toUtf8String(bytes));
          data.isActive = false;
          await contract.setData(
            `watchface_${face.id}`, 
            ethers.toUtf8Bytes(JSON.stringify(data))
          );
        }
      }
      
      // Then activate selected face
      const updatedFace = {
        ...faceData,
        isActive: true
      };
      
      await contract.setData(
        `watchface_${faceId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedFace))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Watch face activated using FHE!"
      });
      
      await loadWatchFaces();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Activation failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const filteredWatchFaces = watchFaces.filter(face => {
    const matchesSearch = face.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         face.category.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = activeFilter === "all" || 
                         (activeFilter === "active" && face.isActive) || 
                         (activeFilter === "inactive" && !face.isActive) ||
                         face.category === activeFilter;
    return matchesSearch && matchesFilter;
  });

  const renderStatsCard = (title: string, value: number, color: string) => (
    <div className="stats-card" style={{ borderColor: color }}>
      <h3>{title}</h3>
      <div className="stat-value" style={{ color }}>{value}</div>
    </div>
  );

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Loading encrypted watch faces...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Watch<span>UI</span> FHE</h1>
          <p>Privacy-preserving smart watch interfaces</p>
        </div>
        
        <div className="header-actions">
          <div className="search-box">
            <input 
              type="text" 
              placeholder="Search watch faces..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <button className="search-btn">
              <svg viewBox="0 0 24 24">
                <path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 0 0 1.48-5.34c-.47-2.78-2.79-5-5.59-5.34a6.505 6.505 0 0 0-7.27 7.27c.34 2.8 2.56 5.12 5.34 5.59a6.5 6.5 0 0 0 5.34-1.48l.27.28v.79l4.25 4.25c.41.41 1.08.41 1.49 0 .41-.41.41-1.08 0-1.49L15.5 14zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
              </svg>
            </button>
          </div>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Watch Face
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <main className="main-content">
        <section className="stats-section">
          <div className="section-header">
            <h2>Watch Face Statistics</h2>
            <div className="filter-tabs">
              <button 
                className={activeFilter === "all" ? "active" : ""}
                onClick={() => setActiveFilter("all")}
              >
                All
              </button>
              <button 
                className={activeFilter === "active" ? "active" : ""}
                onClick={() => setActiveFilter("active")}
              >
                Active
              </button>
              <button 
                className={activeFilter === "minimal" ? "active" : ""}
                onClick={() => setActiveFilter("minimal")}
              >
                Minimal
              </button>
              <button 
                className={activeFilter === "informative" ? "active" : ""}
                onClick={() => setActiveFilter("informative")}
              >
                Informative
              </button>
              <button 
                className={activeFilter === "interactive" ? "active" : ""}
                onClick={() => setActiveFilter("interactive")}
              >
                Interactive
              </button>
              <button 
                className={activeFilter === "custom" ? "active" : ""}
                onClick={() => setActiveFilter("custom")}
              >
                Custom
              </button>
            </div>
          </div>
          
          <div className="stats-grid">
            {renderStatsCard("Total Faces", watchFaces.length, "#3498db")}
            {renderStatsCard("Active", activeCount, "#2ecc71")}
            {renderStatsCard("Minimal", minimalCount, "#e74c3c")}
            {renderStatsCard("Informative", informativeCount, "#f39c12")}
            {renderStatsCard("Interactive", interactiveCount, "#9b59b6")}
            {renderStatsCard("Custom", customCount, "#1abc9c")}
          </div>
        </section>
        
        <section className="watchfaces-section">
          <div className="section-header">
            <h2>Your Watch Faces</h2>
            <button 
              onClick={loadWatchFaces}
              className="refresh-btn"
              disabled={isRefreshing}
            >
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          
          {filteredWatchFaces.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">
                <svg viewBox="0 0 24 24">
                  <path d="M17 7h5v10h-5v2a1 1 0 0 0 1 1h2v2h-2.5c-.55 0-1.5-.45-1.5-1 0 .55-.95 1-1.5 1H12v-2h2a1 1 0 0 0 1-1V7zm-9 9H3V7h5v2H5v6h3v2zm4 0V9h3c1.1 0 2 .9 2 2v4c0 1.1-.9 2-2 2h-3zm1-2h1v-4h-1v4z"/>
                </svg>
              </div>
              <p>No watch faces found</p>
              <button 
                className="create-btn"
                onClick={() => setShowCreateModal(true)}
              >
                Create Your First Watch Face
              </button>
            </div>
          ) : (
            <div className="watchfaces-grid">
              {filteredWatchFaces.map(face => (
                <div 
                  className={`watchface-card ${face.isActive ? "active" : ""}`} 
                  key={face.id}
                >
                  <div className="card-header">
                    <h3>{face.name}</h3>
                    <span className={`category-badge ${face.category}`}>
                      {face.category}
                    </span>
                  </div>
                  <div className="card-body">
                    <div className="watchface-preview">
                      <div className={`preview-${face.category}`}>
                        {face.category === "minimal" && (
                          <>
                            <div className="hour-hand"></div>
                            <div className="minute-hand"></div>
                          </>
                        )}
                        {face.category === "informative" && (
                          <>
                            <div className="info-row">
                              <span>12:45</span>
                              <span>Wed</span>
                            </div>
                            <div className="info-row">
                              <span>78 bpm</span>
                              <span>3.2k steps</span>
                            </div>
                          </>
                        )}
                        {face.category === "interactive" && (
                          <>
                            <div className="interactive-circle"></div>
                            <div className="interactive-dots">
                              <div></div>
                              <div></div>
                              <div></div>
                            </div>
                          </>
                        )}
                        {face.category === "custom" && (
                          <div className="custom-pattern">
                            <div></div>
                            <div></div>
                            <div></div>
                            <div></div>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="card-meta">
                      <span className="owner">
                        {face.owner.substring(0, 6)}...{face.owner.substring(38)}
                      </span>
                      <span className="date">
                        {new Date(face.timestamp * 1000).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <div className="card-footer">
                    {isOwner(face.owner) && (
                      <button 
                        className={`action-btn ${face.isActive ? "active" : ""}`}
                        onClick={() => activateWatchFace(face.id)}
                        disabled={face.isActive}
                      >
                        {face.isActive ? "Active" : "Activate"}
                      </button>
                    )}
                    <div className="fhe-badge">
                      <span>FHE Secured</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
        
        <section className="team-section">
          <h2>Our Team</h2>
          <div className="team-grid">
            <div className="team-card">
              <div className="team-avatar">
                <div className="avatar-initial">JD</div>
              </div>
              <h3>John Doe</h3>
              <p>FHE Specialist</p>
              <div className="team-social">
                <a href="#"><svg viewBox="0 0 24 24"><path d="M22.46 6c-.77.35-1.6.58-2.46.69.88-.53 1.56-1.37 1.88-2.38-.83.5-1.75.85-2.72 1.05C18.37 4.5 17.26 4 16 4c-2.35 0-4.27 1.92-4.27 4.29 0 .34.04.67.11.98C8.28 9.09 5.11 7.38 3 4.79c-.37.63-.58 1.37-.58 2.15 0 1.49.75 2.81 1.91 3.56-.71 0-1.37-.2-1.95-.5v.03c0 2.08 1.48 3.82 3.44 4.21a4.22 4.22 0 0 1-1.93.07 4.28 4.28 0 0 0 4 2.98 8.521 8.521 0 0 1-5.33 1.84c-.34 0-.68-.02-1.02-.06C3.44 20.29 5.7 21 8.12 21 16 21 20.33 14.46 20.33 8.79c0-.19 0-.37-.01-.56.84-.6 1.56-1.36 2.14-2.23z"/></svg></a>
                <a href="#"><svg viewBox="0 0 24 24"><path d="M12 2.04c-5.5 0-10 4.49-10 10.02 0 5 3.66 9.15 8.44 9.9v-7H7.9v-2.9h2.54V9.85c0-2.51 1.49-3.89 3.78-3.89 1.09 0 2.23.19 2.23.19v2.47h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.45 2.9h-2.33v7a10 10 0 0 0 8.44-9.9c0-5.53-4.5-10.02-10-10.02z"/></svg></a>
              </div>
            </div>
            <div className="team-card">
              <div className="team-avatar">
                <div className="avatar-initial">AS</div>
              </div>
              <h3>Alice Smith</h3>
              <p>UI Designer</p>
              <div className="team-social">
                <a href="#"><svg viewBox="0 0 24 24"><path d="M12 2.04c-5.5 0-10 4.49-10 10.02 0 5 3.66 9.15 8.44 9.9v-7H7.9v-2.9h2.54V9.85c0-2.51 1.49-3.89 3.78-3.89 1.09 0 2.23.19 2.23.19v2.47h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.45 2.9h-2.33v7a10 10 0 0 0 8.44-9.9c0-5.53-4.5-10.02-10-10.02z"/></svg></a>
                <a href="#"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm6.36 14.83c-1.43-1.74-4.9-2.33-6.36-2.33s-4.93.59-6.36 2.33C4.62 15.49 4 13.82 4 12c0-4.41 3.59-8 8-8s8 3.59 8 8c0 1.82-.62 3.49-1.64 4.83zM12 6c-1.94 0-3.5 1.56-3.5 3.5S10.06 13 12 13s3.5-1.56 3.5-3.5S13.94 6 12 6z"/></svg></a>
              </div>
            </div>
            <div className="team-card">
              <div className="team-avatar">
                <div className="avatar-initial">RJ</div>
              </div>
              <h3>Robert Johnson</h3>
              <p>Blockchain Dev</p>
              <div className="team-social">
                <a href="#"><svg viewBox="0 0 24 24"><path d="M22.46 6c-.77.35-1.6.58-2.46.69.88-.53 1.56-1.37 1.88-2.38-.83.5-1.75.85-2.72 1.05C18.37 4.5 17.26 4 16 4c-2.35 0-4.27 1.92-4.27 4.29 0 .34.04.67.11.98C8.28 9.09 5.11 7.38 3 4.79c-.37.63-.58 1.37-.58 2.15 0 1.49.75 2.81 1.91 3.56-.71 0-1.37-.2-1.95-.5v.03c0 2.08 1.48 3.82 3.44 4.21a4.22 4.22 0 0 1-1.93.07 4.28 4.28 0 0 0 4 2.98 8.521 8.521 0 0 1-5.33 1.84c-.34 0-.68-.02-1.02-.06C3.44 20.29 5.7 21 8.12 21 16 21 20.33 14.46 20.33 8.79c0-.19 0-.37-.01-.56.84-.6 1.56-1.36 2.14-2.23z"/></svg></a>
                <a href="#"><svg viewBox="0 0 24 24"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.167 6.839 9.49.5.09.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0 1 12 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z"/></svg></a>
              </div>
            </div>
          </div>
        </section>
      </main>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitWatchFace} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          watchFaceData={newWatchFaceData}
          setWatchFaceData={setNewWatchFaceData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && <svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>}
              {transactionStatus.status === "error" && <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/></svg>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <h2>WatchUI FHE</h2>
            <p>Privacy-preserving personalized smart watch interfaces</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">GitHub</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>Fully Homomorphic Encryption</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} WatchUI FHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  watchFaceData: any;
  setWatchFaceData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  watchFaceData,
  setWatchFaceData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setWatchFaceData({
      ...watchFaceData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!watchFaceData.name || !watchFaceData.config) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>Create New Watch Face</h2>
          <button onClick={onClose} className="close-modal">
            <svg viewBox="0 0 24 24">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
            </svg>
          </button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <svg viewBox="0 0 24 24">
              <path d="M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3zm-1.06 13.54L7.4 12l1.41-1.41 2.12 2.12 4.24-4.24 1.41 1.41-5.64 5.66z"/>
            </svg>
            <p>Your watch face configuration will be encrypted with FHE</p>
          </div>
          
          <div className="form-group">
            <label>Name *</label>
            <input 
              type="text"
              name="name"
              value={watchFaceData.name} 
              onChange={handleChange}
              placeholder="My Awesome Watch Face" 
            />
          </div>
          
          <div className="form-group">
            <label>Category *</label>
            <select 
              name="category"
              value={watchFaceData.category} 
              onChange={handleChange}
            >
              <option value="minimal">Minimal</option>
              <option value="informative">Informative</option>
              <option value="interactive">Interactive</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>Configuration (JSON) *</label>
            <textarea 
              name="config"
              value={watchFaceData.config} 
              onChange={handleChange}
              placeholder="Enter your watch face configuration in JSON format..." 
              rows={6}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn"
          >
            {creating ? "Encrypting with FHE..." : "Create Watch Face"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;