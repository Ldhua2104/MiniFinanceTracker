import { useEffect, useState } from 'react';
import { apiRequest } from '../api/client.js';

export function ProfileAvatar({ className, src, name }) {
  if (src) return <img className={`${className} profile-avatar-image`} src={src} alt={name} />;
  const initials = (name || 'Default User').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'DU';
  return <span className={className} aria-label={name}>{initials}</span>;
}

export function ProfilePage({ user, anonymousProfile, onAnonymousProfileChange, onUserUpdated, t, onAuthenticated, onSignOut, migration, onMigration }) {
  const [mode, setMode] = useState('login');
  const [authOpen, setAuthOpen] = useState(false);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [profileDraft, setProfileDraft] = useState({ username: user?.username ?? anonymousProfile.username, avatar: user?.avatar ?? anonymousProfile.avatar });
  const [profileSaved, setProfileSaved] = useState(false);

  useEffect(() => {
    setProfileDraft({ username: user?.username ?? anonymousProfile.username, avatar: user?.avatar ?? anonymousProfile.avatar });
  }, [user, anonymousProfile.username, anonymousProfile.avatar]);

  function updateProfileField(key, value) {
    if (user) {
      setProfileDraft((current) => ({ ...current, [key]: value }));
      setProfileSaved(false);
    } else {
      onAnonymousProfileChange({ ...anonymousProfile, [key]: value });
    }
  }

  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email')).trim();
    const password = String(form.get('password'));
    if (mode === 'register') {
      if (password.length < 12) return setError(t('passwordShort'));
      if (password !== form.get('confirmPassword')) return setError(t('passwordMismatch'));
    }
    setError('');
    setWorking(true);
    try {
      const body = { email, password };
      if (mode === 'register') {
        body.username = anonymousProfile.username.trim() || t('defaultUser');
        body.avatar = anonymousProfile.avatar;
      }
      const response = await apiRequest(`/auth/${mode === 'register' ? 'register' : 'login'}`, {
        method: 'POST', body: JSON.stringify(body)
      });
      await onAuthenticated(response.data);
      setAuthOpen(false);
    } catch (authError) {
      setError(authError.message || t('authFailed'));
    } finally {
      setWorking(false);
    }
  }

  function changeAvatar(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError(t('avatarTypeError'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        updateProfileField('avatar', reader.result);
        setError('');
      }
    };
    reader.onerror = () => setError(t('avatarTypeError'));
    reader.readAsDataURL(file);
  }

  async function saveProfile(event) {
    event.preventDefault();
    if (!profileDraft.username.trim()) return setError(t('fieldRequired'));
    setWorking(true);
    setError('');
    setProfileSaved(false);
    try {
      const response = await apiRequest('/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({ username: profileDraft.username, avatar: profileDraft.avatar })
      });
      onUserUpdated(response.data);
      setProfileSaved(true);
    } catch (profileError) {
      setError(profileError.message || t('saveFailed'));
    } finally {
      setWorking(false);
    }
  }

  async function migrate(choice) {
    setWorking(true);
    setError('');
    try { await onMigration(choice); }
    catch { setError(t('saveFailed')); }
    finally { setWorking(false); }
  }

  function openAuth(nextMode = 'login') {
    setMode(nextMode);
    setError('');
    setAuthOpen(true);
  }

  return (
    <section className="profile-view">
      <div className="page-heading profile-heading"><div><div className="eyebrow">{t('profile')}</div><h1>{t('security')}</h1><p>{t('profileIntro')}</p></div></div>
      {migration ? (
        <article className="panel migration-panel">
          <span className="migration-icon">?</span><div className="eyebrow">{t('migrationTitle')}</div><h2>{t('migrationTitle')}</h2><p>{t('migrationText')}</p>
          {error && <div className="inline-error">{error}</div>}
          <div className="migration-actions"><button className="primary-button" disabled={working} onClick={() => void migrate('merge')}>{t('merge')} <span>?</span></button><button className="secondary-button" disabled={working} onClick={() => void migrate('server')}>{t('keepServer')}</button></div>
        </article>
      ) : (
        <>
          <article className="panel profile-card">
            <div className="profile-identity">
              <div className="profile-avatar-wrap">
                <ProfileAvatar className="profile-avatar-large" src={user ? profileDraft.avatar : anonymousProfile.avatar} name={user ? profileDraft.username : anonymousProfile.username} />
                <label className="avatar-change-button">{t('changeAvatar')}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={changeAvatar} aria-label={t('changeAvatar')} /></label>
              </div>
              <div className="profile-details">
                {user && <><p className="profile-email">{user.email}</p><small>{t('roleUser')} · {user.baseCurrency}</small></>}
                <label className="field"><span>{t('username')}</span><input type="text" maxLength="60" value={user ? profileDraft.username : anonymousProfile.username} onChange={(event) => updateProfileField('username', event.target.value)} /></label>
                <p className="profile-hint">{t(user ? 'profileAccountEditHint' : 'profileEditHint')}</p>
              </div>
            </div>
            {error && !authOpen && <div className="inline-error">{error}</div>}
            {user ? <div className="profile-signed-actions"><button className="primary-button" onClick={saveProfile} disabled={working}>{working ? '?' : t('saveProfile')}</button><button className="secondary-button" onClick={onSignOut}>{t('signOut')}</button></div> : (
              <div className="profile-auth-prompt"><p>{t('profileLoginPrompt')}</p><button className="primary-button" onClick={() => openAuth('login')}>{t('loginOrRegister')} <span>?</span></button></div>
            )}
            {profileSaved && <p className="profile-save-status">{t('profileSaved')}</p>}
          </article>
          {authOpen && <div className="auth-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !working) setAuthOpen(false); }}>
            <section className="panel auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
              <div className="auth-modal-heading"><div><div className="eyebrow">{t('profile')}</div><h2 id="auth-modal-title">{mode === 'register' ? t('register') : t('signIn')}</h2><p>{t('authModalIntro')}</p></div><button className="icon-button auth-modal-close" type="button" onClick={() => setAuthOpen(false)} aria-label={t('close')} disabled={working}>x</button></div>
              <div className="auth-tabs"><button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); }}>{t('signIn')}</button><button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); }}>{t('register')}</button></div>
              <form onSubmit={submit}>
                <label className="field"><span>{t('email')}</span><input name="email" type="email" autoComplete="email" required /></label>
                <label className="field"><span>{t('password')}</span><input name="password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength={mode === 'register' ? 12 : 1} maxLength="128" required /></label>
                {mode === 'register' && <label className="field"><span>{t('confirmPassword')}</span><input name="confirmPassword" type="password" autoComplete="new-password" minLength="12" maxLength="128" required /></label>}
                {error && <div className="inline-error">{error}</div>}
                <button className="primary-button auth-submit" type="submit" disabled={working}>{working ? '?' : mode === 'register' ? t('register') : t('signIn')} <span>?</span></button>
              </form>
              <div className="auth-switch">{mode === 'register' ? t('already') : t('noAccount')} <button type="button" onClick={() => { setMode(mode === 'register' ? 'login' : 'register'); setError(''); }}>{mode === 'register' ? t('switchLogin') : t('switchRegister')}</button></div>
              {!user && <div className="local-privacy"><span>i</span>{t('localNote')}</div>}
            </section>
          </div>}
        </>
      )}
    </section>
  );
}
