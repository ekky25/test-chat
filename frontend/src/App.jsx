import React, { useState } from 'react';
import { Turnstile } from '@marsidev/react-turnstile';
import './App.css';

export default function App() {
  const [isVerified, setIsVerified] = useState(false);
  const [password, setPassword] = useState('');

  // .env dosyasından anahtarı çekiyoruz:
  const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!isVerified) return;
    console.log('Gönderilen Şifre:', password);
  };

  return (
    <div className="container">
      <form onSubmit={handleSubmit} className="box-wrapper">
        <input 
          type="password" 
          placeholder={isVerified ? "Şifreyi girin..." : "Önce doğrulamayı tamamlayın"} 
          className={`center-input ${!isVerified ? 'disabled' : ''}`}
          disabled={!isVerified}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus={isVerified}
        />

        <div className="turnstile-container">
          <Turnstile 
            siteKey={turnstileSiteKey}
            options={{ theme: 'dark', size: 'flexible' }}
            onSuccess={() => setIsVerified(true)}
            onExpire={() => setIsVerified(false)}
          />
        </div>
      </form>
    </div>
  );
}