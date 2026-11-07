import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { Turnstile } from '@marsidev/react-turnstile';
import { deriveKey, encryptMessage, decryptMessage } from './crypto';
import './App.css';

let socket = null;

export default function App() {
  const [sessionToken, setSessionToken] = useState(null);
  const [currentStep, setCurrentStep] = useState('USERNAME');
  const [inputValue, setInputValue] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [lockCountdown, setLockCountdown] = useState(0);

  // Oturum State'leri
  const [activeUser, setActiveUser] = useState('');
  const [userRole, setUserRole] = useState('member');
  const [cryptoKey, setCryptoKey] = useState(null);

  // Chat State'leri
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const messagesEndRef = useRef(null);

  // Online Kullanıcılar & Admin Paneli
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [adminTab, setAdminTab] = useState('users'); // 'users' | 'add' | 'online'
  const [dbUsers, setDbUsers] = useState([]);
  const [adminStatus, setAdminStatus] = useState('');

  // Yeni Kullanıcı Formu
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('member');

  const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (lockCountdown <= 0) return;
    const timer = setInterval(() => {
      setLockCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setStatusMessage('Kilit süresi bitti. Tekrar deneyebilirsiniz.');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [lockCountdown]);

  // Socket.io Olayları
  useEffect(() => {
    if (currentStep !== 'CHAT' || !cryptoKey) return;

    socket = io('http://localhost:3000');
    socket.emit('join_room', { roomId: 'default_room', username: activeUser, role: userRole });

    socket.on('receive_message', async (data) => {
      const plainText = await decryptMessage(data.encrypted, cryptoKey);
      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(),
          sender: data.sender,
          text: plainText,
          time: new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isMe: false
        }
      ]);
    });

    // Anlık aktif kullanıcı listesi dinleyicisi
    socket.on('online_users_update', (users) => {
      setOnlineUsers(users);
    });

    socket.on('error_message', (msg) => {
      alert(msg);
    });

    return () => {
      if (socket) socket.disconnect();
    };
  }, [currentStep, cryptoKey, activeUser, userRole]);

  // Admin: Veritabanındaki tüm kullanıcıları çek
  const fetchDbUsers = async () => {
    if (userRole !== 'admin' || !sessionToken) return;
    try {
      const res = await fetch('http://localhost:3000/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken })
      });
      const data = await res.json();
      if (data.success) {
        setDbUsers(data.users);
      }
    } catch {
      setAdminStatus('Kullanıcı listesi alınamadı.');
    }
  };

  useEffect(() => {
    if (showAdminPanel && userRole === 'admin') {
      fetchDbUsers();
    }
  }, [showAdminPanel, userRole]);

  const handleTurnstileSuccess = async (token) => {
    try {
      const res = await fetch('http://localhost:3000/api/verify-captcha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      const data = await res.json();
      if (data.success) {
        setSessionToken(data.sessionToken);
        setStatusMessage('');
      } else {
        setStatusMessage(data.message || 'Bot doğrulaması geçersiz.');
      }
    } catch {
      setStatusMessage('Sunucuya ulaşılamadı.');
    }
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    if (!sessionToken || loading || lockCountdown > 0 || !inputValue.trim()) return;

    setLoading(true);
    setStatusMessage('Kontrol ediliyor...');

    let endpoint = currentStep === 'USERNAME' ? '/api/verify-username' : '/api/verify-password';
    let bodyData = currentStep === 'USERNAME' 
      ? { sessionToken, username: inputValue.trim() } 
      : { sessionToken, password: inputValue };

    try {
      const res = await fetch(`http://localhost:3000${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyData)
      });
      const data = await res.json();

      if (data.success) {
        if (currentStep === 'USERNAME') {
          setActiveUser(inputValue.trim());
          setCurrentStep('PASSWORD');
          setInputValue('');
          setStatusMessage('');
        } else if (currentStep === 'PASSWORD') {
          setUserRole(data.role);
          const key = await deriveKey(data.roomKeySecret);
          setCryptoKey(key);
          setCurrentStep('CHAT');
          setInputValue('');
          setStatusMessage('');
        }
      } else {
        if (data.needCaptcha) {
          setSessionToken(null);
          setCurrentStep('USERNAME');
        }
        if (data.isLocked && data.remainingSec) {
          setLockCountdown(data.remainingSec);
        }
        setStatusMessage(data.message || 'Hatalı işlem.');
        setInputValue('');
      }
    } catch {
      setStatusMessage('Sunucu bağlantı hatası.');
    } finally {
      setLoading(false);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (userRole === 'read_only' || !chatInput.trim() || !cryptoKey || !socket) return;

    const messageText = chatInput.trim();
    setChatInput('');

    const encryptedData = await encryptMessage(messageText, cryptoKey);

    socket.emit('send_message', {
      roomId: 'default_room',
      sender: activeUser,
      encrypted: encryptedData
    });

    setMessages((prev) => [
      ...prev,
      {
        id: Math.random().toString(),
        sender: activeUser,
        text: messageText,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isMe: true
      }
    ]);
  };

  // Admin İşlemleri
  const handleCreateUser = async (e) => {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword.trim()) return;

    try {
      const res = await fetch('http://localhost:3000/api/admin/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionToken,
          newUsername: newUsername.trim(),
          newPassword: newPassword.trim(),
          newRole
        })
      });
      const data = await res.json();
      setAdminStatus(data.message);
      if (data.success) {
        setNewUsername('');
        setNewPassword('');
        fetchDbUsers();
      }
    } catch {
      setAdminStatus('İşlem başarısız.');
    }
  };

  const handleUpdateRole = async (targetUsername, targetRole) => {
    try {
      const res = await fetch('http://localhost:3000/api/admin/update-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken, targetUsername, newRole: targetRole })
      });
      const data = await res.json();
      setAdminStatus(data.message);
      if (data.success) fetchDbUsers();
    } catch {
      setAdminStatus('Rol değiştirilemedi.');
    }
  };

  const handleDeleteUser = async (targetUsername) => {
    if (!window.confirm(`"${targetUsername}" kullanıcısını silmek istediğinize emin misiniz?`)) return;

    try {
      const res = await fetch('http://localhost:3000/api/admin/delete-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken, targetUsername })
      });
      const data = await res.json();
      setAdminStatus(data.message);
      if (data.success) fetchDbUsers();
    } catch {
      setAdminStatus('Kullanıcı silinemedi.');
    }
  };

  // CHAT ODASI
  if (currentStep === 'CHAT') {
    return (
      <div className="chat-container">
        <header className="chat-header">
          <div className="room-indicator">
            <span className="dot" /> default_room
            <span className="user-badge">({activeUser} • {userRole})</span>
          </div>

          <div className="header-actions">
            <span className="e2ee-tag">AES-GCM-256</span>
            {userRole === 'admin' && (
              <button 
                type="button" 
                className={`admin-btn ${showAdminPanel ? 'active' : ''}`}
                onClick={() => setShowAdminPanel(!showAdminPanel)}
              >
                ⚙ Yönetim & Aktifler ({onlineUsers.length})
              </button>
            )}
          </div>
        </header>

        {/* Admin Yönetim Paneli */}
        {showAdminPanel && userRole === 'admin' && (
          <div className="admin-panel">
            <div className="admin-tabs">
              <button 
                className={adminTab === 'users' ? 'tab-active' : ''} 
                onClick={() => setAdminTab('users')}
              >
                Kullanıcılar ({dbUsers.length})
              </button>
              <button 
                className={adminTab === 'online' ? 'tab-active' : ''} 
                onClick={() => setAdminTab('online')}
              >
                Aktif Kişiler ({onlineUsers.length})
              </button>
              <button 
                className={adminTab === 'add' ? 'tab-active' : ''} 
                onClick={() => setAdminTab('add')}
              >
                + Yeni Ekle
              </button>
            </div>

            {adminStatus && <p className="admin-status">{adminStatus}</p>}

            {/* Tab 1: Kayıtlı Kullanıcı Listesi & Yönetimi */}
            {adminTab === 'users' && (
              <div className="user-table-wrap">
                <table className="user-table">
                  <thead>
                    <tr>
                      <th>Kullanıcı</th>
                      <th>Yetki / Rol</th>
                      <th>Durum</th>
                      <th>İşlem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dbUsers.map((u) => {
                      const isOnline = onlineUsers.some(o => o.username === u.username);
                      return (
                        <tr key={u.id}>
                          <td>{u.username}</td>
                          <td>
                            {u.username === activeUser ? (
                              <span className="role-tag">{u.role}</span>
                            ) : (
                              <select 
                                value={u.role} 
                                onChange={(e) => handleUpdateRole(u.username, e.target.value)}
                                className="table-role-select"
                              >
                                <option value="member">member</option>
                                <option value="read_only">read_only</option>
                                <option value="admin">admin</option>
                              </select>
                            )}
                          </td>
                          <td>
                            <span className={`status-badge ${isOnline ? 'online' : 'offline'}`}>
                              {isOnline ? 'Çevrimiçi' : 'Çevrimdışı'}
                            </span>
                          </td>
                          <td>
                            {u.username !== activeUser && (
                              <button 
                                onClick={() => handleDeleteUser(u.username)}
                                className="delete-btn"
                              >
                                Sil
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Tab 2: Sadece Anlık Aktif Kullanıcılar */}
            {adminTab === 'online' && (
              <div className="online-list">
                {onlineUsers.length === 0 ? (
                  <p className="empty-sub">Şu an aktif kimse yok.</p>
                ) : (
                  onlineUsers.map((ou, idx) => (
                    <div key={idx} className="online-user-item">
                      <span className="dot" />
                      <span className="name">{ou.username}</span>
                      <span className="role">[{ou.role}]</span>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Tab 3: Yeni Kullanıcı Oluştur */}
            {adminTab === 'add' && (
              <form onSubmit={handleCreateUser} className="admin-form">
                <input 
                  type="text" 
                  placeholder="Kullanıcı Adı" 
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                />
                <input 
                  type="text" 
                  placeholder="Şifre" 
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                <select 
                  value={newRole} 
                  onChange={(e) => setNewRole(e.target.value)}
                  className="admin-role-select"
                >
                  <option value="member">Üye (Yazar & Okur)</option>
                  <option value="read_only">Sadece İzleyici (Read-Only)</option>
                  <option value="admin">Yönetici (Admin)</option>
                </select>
                <button type="submit">Oluştur</button>
              </form>
            )}
          </div>
        )}

        <div className="messages-area">
          {messages.length === 0 ? (
            <div className="empty-chat">Uçtan uca şifreli oda. Mesajlaşmaya başlayın.</div>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={`message-row ${m.isMe ? 'me' : 'other'}`}>
                <div className="message-bubble">
                  {!m.isMe && <span className="sender-name">{m.sender}</span>}
                  <p className="message-text">{m.text}</p>
                  <span className="message-time">{m.time}</span>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={handleSendMessage} className="chat-input-bar">
          <input
            type="text"
            placeholder={userRole === 'read_only' ? "Sadece görüntüleme izniniz var (Mesaj yazamazsınız)" : "Şifreli bir mesaj yazın..."}
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            disabled={userRole === 'read_only'}
            className={userRole === 'read_only' ? 'disabled-chat-input' : ''}
            autoFocus={userRole !== 'read_only'}
          />
        </form>
      </div>
    );
  }

  // GİRİŞ EKRANI
  const isInputDisabled = !sessionToken || loading || lockCountdown > 0;
  const getPlaceholder = () => {
    if (lockCountdown > 0) return `Kilitlendi (${lockCountdown}s)`;
    if (!sessionToken) return 'Önce doğrulamayı tamamlayın';
    if (currentStep === 'USERNAME') return 'Kullanıcı adını girin...';
    return 'Şifreyi girin...';
  };

  return (
    <div className="container">
      <form onSubmit={handleAuthSubmit} className="box-wrapper">
        <input
          type={currentStep === 'PASSWORD' ? 'password' : 'text'}
          placeholder={getPlaceholder()}
          className={`center-input ${isInputDisabled ? 'disabled' : ''}`}
          disabled={isInputDisabled}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          autoFocus={Boolean(sessionToken) && lockCountdown === 0}
        />

        {!sessionToken && (
          <div className="turnstile-container">
            <Turnstile
              siteKey={turnstileSiteKey}
              options={{ theme: 'dark', size: 'normal' }}
              onSuccess={handleTurnstileSuccess}
            />
          </div>
        )}

        {statusMessage && (
          <p className="status-text">
            {lockCountdown > 0 ? `Lütfen bekleyin: ${lockCountdown} sn` : statusMessage}
          </p>
        )}
      </form>
    </div>
  );
}