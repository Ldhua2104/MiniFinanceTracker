import { useEffect, useState } from 'react';
import { apiRequest } from '../api/client.js';
import { migrationGroupCounts, MIGRATION_GROUPS } from '../data/finance-data.js';

export function ProfileAvatar({ className, src, name }) {
  if (src) return <img className={`${className} profile-avatar-image`} src={src} alt={name} />;
  const initials = (name || 'Default User').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'DU';
  return <span className={className} aria-label={name}>{initials}</span>;
}

export function ProfilePage({ user, anonymousProfile, onAnonymousProfileChange, onUserUpdated, t, onAuthenticated, onSignOut, migration, onMigration }) {
  const [mode, setMode] = useState('login');
  const [authOpen, setAuthOpen] = useState(false);
  const [passwordChangeOpen, setPasswordChangeOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState(!user);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [profileDraft, setProfileDraft] = useState({ username: user?.username ?? anonymousProfile.username, avatar: user?.avatar ?? anonymousProfile.avatar });
  const [profileSaved, setProfileSaved] = useState(false);
  const [migrationActions, setMigrationActions] = useState({});

  useEffect(() => {
    if (migration) setMigrationActions(Object.fromEntries(MIGRATION_GROUPS.map((group) => [group, 'merge'])));
  }, [migration]);

  useEffect(() => {
    setProfileDraft({ username: user?.username ?? anonymousProfile.username, avatar: user?.avatar ?? anonymousProfile.avatar });
    setEditingProfile(!user);
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
    if (mode === 'reset') return;
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
      const response = await apiRequest(`/auth/${mode === 'register' ? 'register' : 'login'}`, { method: 'POST', body: JSON.stringify(body) });
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
      const response = await apiRequest('/auth/profile', { method: 'PATCH', body: JSON.stringify({ username: profileDraft.username.trim(), avatar: profileDraft.avatar }) });
      onUserUpdated(response.data);
      setProfileSaved(true);
      setEditingProfile(false);
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
    catch (migrationError) {
      const details = migrationError.issues?.length
        ? migrationError.issues.map((issue) => `${issue.path || 'data'}: ${migrationError.message === 'migrationInvalidTransaction' ? t('migrationMissingRequiredData') : issue.message}`)
        : Object.entries(migrationError.fields ?? {}).flatMap(([field, messages]) => (Array.isArray(messages) ? messages : [messages]).filter(Boolean).map((message) => `${field}: ${message}`));
      const prefix = migrationError.status === 400 ? t('migrationValidationFailed') : t('migrationFieldsNeedAttention');
      setError(details.length ? `${prefix} ${details.join(' · ')}` : t(migrationError.message) === migrationError.message ? t('migrationFailed') : t(migrationError.message));
    }
    finally { setWorking(false); }
  }

  function openAuth(nextMode = 'login') {
    setMode(nextMode);
    setError('');
    setAuthOpen(true);
  }

  function cancelProfileEdit() {
    setProfileDraft({ username: user.username, avatar: user.avatar });
    setEditingProfile(false);
    setError('');
  }

  return (
    <section className="profile-view">
      <div className="page-heading profile-heading"><div><div className="eyebrow">{t('profile')}</div><h1>{t('profilePageTitle')}</h1><p>{t('profilePageIntro')}</p></div></div>
      {migration ? (
        <article className="panel migration-panel">
          <div className="eyebrow">{t('migrationTitle')}</div><h2>{migration.cloudEmpty ? t('migrationEmptyTitle') : t('migrationExistingTitle')}</h2><p>{migration.cloudEmpty ? t('migrationEmptyText') : t('migrationExistingText')}</p>
          <div className="migration-comparison">
            <div className="migration-comparison-heading"><strong>{t('migrationLocalHeading')}</strong><strong>{t('migrationCloudHeading')}</strong><span>{t('migrationActionHeading')}</span></div>
            {(() => {
              const localCounts = migrationGroupCounts(migration.local);
              const cloudCounts = migrationGroupCounts(migration.remote);
              return MIGRATION_GROUPS.map((group) => <div className="migration-comparison-row" key={group}>
                <div className="migration-group-name"><strong>{t(`migrationGroup_${group}`)}</strong><small>{localCounts[group]} {t('migrationItems')}</small></div>
                <div className="migration-cloud-count"><strong>{cloudCounts[group]}</strong><small>{t('migrationItems')}</small></div>
                <label className="migration-choice"><span className="sr-only">{t(`migrationGroup_${group}`)}</span><select value={migrationActions[group] ?? 'merge'} onChange={(event) => setMigrationActions((current) => ({ ...current, [group]: event.target.value }))}>
                  <option value="merge">{migration.cloudEmpty ? t('migrationImport') : t('migrationMerge')}</option>
                  {!migration.cloudEmpty && <option value="cloud">{t('migrationUseCloud')}</option>}
                  <option value="keep">{t('migrationKeepLocal')}</option>
                </select></label>
              </div>);
            })()}
          </div>
          <p className="migration-footnote">{t(migration.cloudEmpty ? 'migrationEmptyNote' : 'migrationExistingNote')}</p>
          {migrationActions.transactions === 'merge' && (() => {
            const missingTitleCount = migration.local.transactions.filter((item) => !(item.title ?? '').trim() && !(item.note ?? '').trim()).length;
            return missingTitleCount > 0 && <p className="migration-title-warning">{missingTitleCount} {t('migrationTitleFallbackHint')}</p>;
          })()}
          {error && <div className="inline-error">{error}</div>}
          <div className="migration-actions"><button className="primary-button" disabled={working} onClick={() => void migrate(migrationActions)}>{working ? t('migrationWorking') : t('migrationConfirm')}</button></div>
        </article>
      ) : (
        <>
          <article className="panel profile-card">
            <div className="profile-section-heading"><div><div className="eyebrow">{t('profileSection')}</div><h2>{t('profileSection')}</h2></div></div>
            <div className="profile-identity">
              <div className="profile-avatar-wrap">
                <ProfileAvatar className="profile-avatar-large" src={user ? profileDraft.avatar : anonymousProfile.avatar} name={user ? profileDraft.username : anonymousProfile.username} />
                {editingProfile && <>
                  <label className="avatar-change-button">{t('changeAvatar')}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={changeAvatar} aria-label={t('changeAvatar')} /></label>
                  {(user ? profileDraft.avatar : anonymousProfile.avatar) && <button className="profile-reset-avatar" type="button" onClick={() => updateProfileField('avatar', '')}>{t('resetAvatar')}</button>}
                </>}
              </div>
              <div className="profile-details">
                <label className="field"><span>{t('username')}</span>{editingProfile ? <input type="text" maxLength="60" value={user ? profileDraft.username : anonymousProfile.username} onChange={(event) => updateProfileField('username', event.target.value)} /> : <strong className="profile-name-display">{user.username}</strong>}</label>
              </div>
            </div>
            {!user && <p className="profile-local-notice">{t('localProfileNotice')}</p>}
            {error && !authOpen && <div className="inline-error">{error}</div>}
            {user && editingProfile && <div className="profile-signed-actions"><button className="primary-button" onClick={saveProfile} disabled={working || (!profileDraft.username.trim() || (profileDraft.username === user.username && profileDraft.avatar === user.avatar))}>{working ? '?' : t('saveProfile')}</button><button className="secondary-button" type="button" onClick={cancelProfileEdit} disabled={working}>{t('cancelEdit')}</button></div>}
            {!user && <div className="profile-auth-prompt"><p>{t('profileLoginPrompt')}</p><button className="primary-button" onClick={() => openAuth('login')}>{t('loginOrRegister')} <span>?</span></button></div>}
            {profileSaved && <p className="profile-save-status">{t('profileSaved')}</p>}
          </article>
          {user && <article className="panel profile-account-card">
            <div className="profile-account-heading"><div><div className="eyebrow">{t('accountSection')}</div><h2>{t('account')}</h2></div>{!editingProfile && <button className="secondary-button profile-edit-button" type="button" onClick={() => { setEditingProfile(true); setProfileSaved(false); }}>{t('editProfile')}</button>}</div>
            <div className="profile-account-grid profile-account-credentials">
              <div><span>{t('email')}</span><strong>{user.email}</strong></div>
              <div><span>{t('password')}</span><strong className="profile-masked-password" aria-label={t('passwordHidden')}>••••••••••••</strong><button className="profile-change-password" type="button" onClick={() => setPasswordChangeOpen(true)}>{t('changePassword')}</button></div>
            </div>
            <button className="secondary-button profile-signout-button" onClick={onSignOut}>{t('signOut')}</button>
          </article>}
          {passwordChangeOpen && <div className="auth-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPasswordChangeOpen(false); }}>
            <section className="panel auth-modal password-change-preview" role="dialog" aria-modal="true" aria-labelledby="password-change-title">
              <div className="auth-modal-heading"><div><div className="eyebrow">{t('accountSection')}</div><h2 id="password-change-title">{t('changePassword')}</h2></div><button className="icon-button auth-modal-close" type="button" onClick={() => setPasswordChangeOpen(false)} aria-label={t('close')}>×</button></div>
              <p>{t('changePasswordComingSoon')}</p>
              <button className="secondary-button" type="button" onClick={() => setPasswordChangeOpen(false)}>{t('close')}</button>
            </section>
          </div>}
          {authOpen && <div className="auth-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !working) setAuthOpen(false); }}>
            <section className="panel auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
              <div className="auth-modal-heading"><div><div className="eyebrow">{t('profile')}</div><h2 id="auth-modal-title">{mode === 'register' ? t('register') : mode === 'reset' ? t('resetPasswordTitle') : t('signIn')}</h2><p>{mode === 'reset' ? t('resetPasswordHint') : t('authModalIntro')}</p></div><button className="icon-button auth-modal-close" type="button" onClick={() => setAuthOpen(false)} aria-label={t('close')} disabled={working}>×</button></div>
              {mode === 'reset' ? <div className="password-reset-preview"><p>{t('resetPasswordComingSoon')}</p><button className="secondary-button" type="button" onClick={() => { setMode('login'); setError(''); }}>{t('backToSignIn')}</button></div> : <>
                <div className="auth-tabs"><button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); }}>{t('signIn')}</button><button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); }}>{t('register')}</button></div>
                <form onSubmit={submit}>
                  <label className="field"><span>{t('email')}</span><input name="email" type="email" autoComplete="email" required /></label>
                  <label className="field"><span>{t('password')}</span><input name="password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength={mode === 'register' ? 12 : 1} maxLength="128" required /></label>
                  {mode === 'login' && <button className="auth-forgot-password" type="button" onClick={() => { setMode('reset'); setError(''); }}>{t('resetPasswordLink')}</button>}
                  {mode === 'register' && <label className="field"><span>{t('confirmPassword')}</span><input name="confirmPassword" type="password" autoComplete="new-password" minLength="12" maxLength="128" required /></label>}
                  {error && <div className="inline-error">{error}</div>}
                  <button className="primary-button auth-submit" type="submit" disabled={working}>{working ? '?' : mode === 'register' ? t('register') : t('signIn')} <span>?</span></button>
                </form>
                <div className="auth-switch">{mode === 'register' ? t('already') : t('noAccount')} <button type="button" onClick={() => { setMode(mode === 'register' ? 'login' : 'register'); setError(''); }}>{mode === 'register' ? t('switchLogin') : t('switchRegister')}</button></div>
                {!user && <div className="local-privacy"><span>i</span>{t('localNote')}</div>}
              </>}
            </section>
          </div>}
        </>
      )}
    </section>
  );
}
