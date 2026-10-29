import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../api/client.js';
import { emptyAiSettings, loadLocalAiSettings, migrateLocalAiSettings } from '../data/ai-settings.js';
import { PageTitle } from '../components/PageTitle.jsx';

export const AI_TEST_ERROR_KEYS = {
  AI_TEST_KEY_MISSING: 'aiTestKeyMissing',
  AI_TEST_ASSIGNMENT_MISSING: 'aiTestAssignmentMissing',
  AI_TEST_MODEL_NOT_FOUND: 'aiTestModelNotFound',
  AI_TEST_PROVIDER_NOT_FOUND: 'aiTestProviderNotFound',
  AI_TEST_ENDPOINT_INVALID: 'aiTestEndpointInvalid',
  AI_TEST_INSECURE_ENDPOINT: 'aiTestInsecureEndpoint',
  AI_TEST_ENDPOINT_BLOCKED: 'aiTestEndpointBlocked',
  AI_TEST_AUTH_FAILED: 'aiTestAuthFailed',
  AI_TEST_MODEL_OR_ENDPOINT_NOT_FOUND: 'aiTestModelOrEndpointNotFound',
  AI_TEST_RATE_LIMITED: 'aiTestRateLimited',
  AI_TEST_TIMEOUT: 'aiTestTimeout',
  AI_TEST_PROVIDER_UNAVAILABLE: 'aiTestProviderUnavailable',
  AI_TEST_NETWORK: 'aiTestNetwork',
  AI_TEST_DNS_FAILED: 'aiTestNetwork',
  AI_TEST_REQUEST_REJECTED: 'aiTestRequestRejected',
  AI_TEST_REDIRECT_UNSUPPORTED: 'aiTestRedirectUnsupported',
  AI_TEST_INVALID_RESPONSE: 'aiTestInvalidResponse',
  AI_TEST_RESPONSE_TOO_LARGE: 'aiTestInvalidResponse',
  AI_TEST_REQUEST_FAILED: 'aiTestRequestFailed',
  AI_TEST_INVALID_TASK: 'aiTestRequestFailed',
  AI_TEST_SAVE_FAILED: 'aiTestSaveFailed',
  AI_TEST_SESSION_EXPIRED: 'aiTestSessionExpired',
  AI_ENCRYPTION_NOT_CONFIGURED: 'aiTestServerConfiguration',
  AI_ENCRYPTION_KEY_VERSION_UNSUPPORTED: 'aiTestServerConfiguration'
};

export const AI_TEST_RETRYABLE_CODES = new Set(['AI_TEST_RATE_LIMITED', 'AI_TEST_TIMEOUT', 'AI_TEST_PROVIDER_UNAVAILABLE', 'AI_TEST_NETWORK', 'AI_TEST_DNS_FAILED']);

export function normalizeAiSettings(settings) {
  const empty = emptyAiSettings();
  return {
    ...empty,
    ...settings,
    assignments: { receipt: settings?.assignments?.receipt || '', conversation: settings?.assignments?.conversation || '' }
  };
}

export function SettingsPage({ t, language, setLanguage, theme, setTheme, timeFormat, setTimeFormat, user, onStartMigration }) {
  const [migrationNotice, setMigrationNotice] = useState('');
  const [migrationWorking, setMigrationWorking] = useState(false);
  const [aiConfig, setAiConfig] = useState(emptyAiSettings);
  const [providerDraft, setProviderDraft] = useState({ type: 'openai', endpoint: '', apiKey: '' });
  const [modelDraft, setModelDraft] = useState({ providerId: '', name: '', customName: '' });
  const [editingModelId, setEditingModelId] = useState(null);
  const [editingModelDraft, setEditingModelDraft] = useState({ providerId: '', name: '', customName: '' });
  const [isTestingAiTasks, setIsTestingAiTasks] = useState(false);
  const [aiTaskTestProgress, setAiTaskTestProgress] = useState(null);
  const [aiTaskTestResults, setAiTaskTestResults] = useState({});
  const [taskAssignmentsSaved, setTaskAssignmentsSaved] = useState(false);
  const [providerKeys, setProviderKeys] = useState({});
  const [showKeys, setShowKeys] = useState({});
  const [showProviderDraftKey, setShowProviderDraftKey] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState(null);
  const [editingEndpointDraft, setEditingEndpointDraft] = useState('');
  const [editingOriginalProvider, setEditingOriginalProvider] = useState(null);
  const [editingOriginalKey, setEditingOriginalKey] = useState('');
  const [aiSaveStatus, setAiSaveStatus] = useState('');
  const lastAiSaveFailure = useRef('');

  async function openFinanceMigration() {
    setMigrationNotice('');
    setMigrationWorking(true);
    try {
      if (!user) {
        setMigrationNotice(t('migrationNeedsLogin'));
        return;
      }
      const started = await onStartMigration();
      if (!started) setMigrationNotice(t('migrationNoData'));
    } catch {
      setMigrationNotice(t('migrationLoadFailed'));
    } finally {
      setMigrationWorking(false);
    }
  }

  function invalidateTaskTests() {
    setAiTaskTestResults({});
    setTaskAssignmentsSaved(false);
  }

  useEffect(() => {
    let active = true;
    setAiSaveStatus('');
    if (!user) {
      setAiConfig(normalizeAiSettings(emptyAiSettings()));
      setProviderKeys({});
      return () => { active = false; };
    }
    async function loadAiSettings() {
      try {
        let response = await migrateLocalAiSettings(apiRequest);
        if (!response) response = (await apiRequest('/auth/ai-settings')).data;
        if (!active) return;
        setAiConfig(normalizeAiSettings(response));
        setProviderKeys({});
      } catch {
        if (!active) return;
        try {
          const local = await loadLocalAiSettings();
          if (!active) return;
          setAiConfig(normalizeAiSettings(local.settings));
          setProviderKeys(local.apiKeys);
          setAiSaveStatus(t('aiMigrationPending'));
        } catch {
          const empty = emptyAiSettings();
          setAiConfig(normalizeAiSettings(empty));
          setProviderKeys({});
          setAiSaveStatus(t('aiSettingsUnavailable'));
        }
      }
    }
    loadAiSettings();
    return () => { active = false; };
  }, [user?.id]);

  const providerNames = { openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Google Gemini', compatible: t('aiCompatibleProvider') };
  const endpointPattern = /^https?:\/\/(?:(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z]{2,63}|localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d{1,5})?(?:\/[^\s?#]*)?(?:\?[^\s#]*)?(?:#[^\s]*)?$/i;
  const providerTypes = ['openai', 'anthropic', 'gemini', 'compatible'];
  function normalizeEndpoint(value) {
    const candidate = value.trim();
    if (!candidate || !endpointPattern.test(candidate)) return '';
    try {
      const parsed = new URL(candidate);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return '';
      parsed.pathname = parsed.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
      return parsed.href.replace(/\/$/, parsed.pathname === '/' && !parsed.search && !parsed.hash ? '' : '/');
    } catch {
      return '';
    }
  }
  const modelId = () => globalThis.crypto?.randomUUID?.() ?? `model-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const addProvider = async (event) => {
    event.preventDefault();
    if (!providerDraft.type || !providerDraft.endpoint.trim() || !providerDraft.apiKey.trim()) {
      setAiSaveStatus(t('aiProviderRequiredFields'));
      return;
    }
    const endpoint = normalizeEndpoint(providerDraft.endpoint);
    if (!endpoint) {
      setAiSaveStatus(t('aiEndpointInvalid'));
      return;
    }
    const provider = { id: modelId(), type: providerDraft.type, endpoint };
    const nextConfig = { ...aiConfig, providers: [...aiConfig.providers, provider] };
    const nextKeys = { ...providerKeys, [provider.id]: providerDraft.apiKey.trim() };
    if (await saveAiSettingsNow(nextConfig, nextKeys)) {
      invalidateTaskTests();
      setProviderDraft({ type: 'openai', endpoint: '', apiKey: '' });
      setShowProviderDraftKey(false);
    }
  };
  const beginProviderEdit = (provider) => {
    setEditingProviderId(provider.id);
    setEditingEndpointDraft(provider.endpoint);
    setEditingOriginalProvider(provider);
    setEditingOriginalKey(providerKeys[provider.id] || '');
  };
  const closeProviderEdit = (providerId) => {
    if (editingOriginalProvider?.id === providerId) {
      setAiConfig((current) => ({ ...current, providers: current.providers.map((provider) => provider.id === providerId ? editingOriginalProvider : provider) }));
      setProviderKeys((current) => {
        const next = { ...current };
        if (editingOriginalKey) next[providerId] = editingOriginalKey;
        else delete next[providerId];
        return next;
      });
    }
    setEditingProviderId(null);
    setEditingEndpointDraft('');
    setEditingOriginalProvider(null);
    setEditingOriginalKey('');
  };
  const finishProviderEdit = async (providerId) => {
    const endpoint = normalizeEndpoint(editingEndpointDraft);
    if (!endpoint) {
      setAiSaveStatus(t(editingEndpointDraft.trim() ? 'aiEndpointInvalid' : 'aiEndpointRequired'));
      return;
    }
    const nextConfig = { ...aiConfig, providers: aiConfig.providers.map((provider) => provider.id === providerId ? { ...provider, endpoint } : provider) };
    const keysToSave = { ...providerKeys };
    if (!keysToSave[providerId]?.trim() && editingOriginalKey) keysToSave[providerId] = editingOriginalKey;
    if (await saveAiSettingsNow(nextConfig, keysToSave)) {
      invalidateTaskTests();
      setEditingProviderId(null);
      setEditingEndpointDraft('');
      setEditingOriginalProvider(null);
      setEditingOriginalKey('');
    }
  };
  const addModel = async (event) => {
    event.preventDefault();
    if (!modelDraft.providerId || !modelDraft.name.trim() || !modelDraft.customName.trim()) return;
    const model = { id: modelId(), providerId: modelDraft.providerId, name: modelDraft.name.trim(), customName: modelDraft.customName.trim() };
    const nextConfig = { ...aiConfig, models: [...aiConfig.models, model] };
    if (await saveAiSettingsNow(nextConfig, providerKeys)) {
      invalidateTaskTests();
      setModelDraft((current) => ({ ...current, name: '', customName: '' }));
    }
  };
  const beginModelEdit = (model) => {
    setEditingModelId(model.id);
    setEditingModelDraft({ providerId: model.providerId, name: model.name, customName: model.customName || model.name });
  };
  const closeModelEdit = () => {
    setEditingModelId(null);
    setEditingModelDraft({ providerId: '', name: '', customName: '' });
  };
  const finishModelEdit = async (modelIdToEdit) => {
    if (!editingModelDraft.providerId || !editingModelDraft.name.trim() || !editingModelDraft.customName.trim()) return;
    const nextConfig = {
      ...aiConfig,
      models: aiConfig.models.map((model) => model.id === modelIdToEdit ? {
        ...model,
        providerId: editingModelDraft.providerId,
        name: editingModelDraft.name.trim(),
        customName: editingModelDraft.customName.trim()
      } : model)
    };
    if (await saveAiSettingsNow(nextConfig, providerKeys)) {
      invalidateTaskTests();
      closeModelEdit();
    }
  };
  const removeProvider = async (providerId) => {
    if (!window.confirm(t('confirmDeleteAiProvider'))) return;
    const models = aiConfig.models.filter((model) => model.providerId !== providerId);
    const modelIds = new Set(models.map((model) => model.id));
    const nextConfig = {
      ...aiConfig,
      providers: aiConfig.providers.filter((provider) => provider.id !== providerId),
      models,
      assignments: Object.fromEntries(Object.entries(aiConfig.assignments).map(([task, assigned]) => [task, modelIds.has(assigned) ? assigned : '']))
    };
    const nextKeys = { ...providerKeys };
    delete nextKeys[providerId];
    if (await saveAiSettingsNow(nextConfig, nextKeys)) {
      invalidateTaskTests();
      if (editingProviderId === providerId) {
        setEditingProviderId(null);
        setEditingEndpointDraft('');
        setEditingOriginalProvider(null);
        setEditingOriginalKey('');
      }
    }
  };
  const removeModel = async (modelIdToRemove) => {
    if (!window.confirm(t('confirmDeleteAiModel'))) return;
    const nextConfig = {
      ...aiConfig,
      models: aiConfig.models.filter((model) => model.id !== modelIdToRemove),
      assignments: Object.fromEntries(Object.entries(aiConfig.assignments).map(([task, assigned]) => [task, assigned === modelIdToRemove ? '' : assigned]))
    };
    if (await saveAiSettingsNow(nextConfig, providerKeys)) {
      invalidateTaskTests();
      if (editingModelId === modelIdToRemove) closeModelEdit();
    }
  };
  async function saveAiSettingsNow(config = aiConfig, keys = providerKeys) {
    setAiSaveStatus(t('aiSaving'));
    lastAiSaveFailure.current = '';
    const configuredProviderIds = new Set(config.providers.map((provider) => provider.id));
    const validModels = config.models.filter((model) => configuredProviderIds.has(model.providerId));
    const validModelIds = new Set(validModels.map((model) => model.id));
    config = {
      ...config,
      models: validModels,
      assignments: Object.fromEntries(['receipt', 'conversation'].map((task) => [task, validModelIds.has(config.assignments?.[task]) ? config.assignments[task] : '']))
    };
    const providerIds = new Set(config.providers.map((provider) => provider.id));
    const effectiveKeys = Object.fromEntries(Object.entries(keys).filter(([providerId, value]) => providerIds.has(providerId) && value.trim()));
    const settings = {
      providers: config.providers.map(({ id, type, endpoint, hasApiKey }) => ({ id, type, endpoint, hasApiKey: Boolean(effectiveKeys[id] || hasApiKey) })),
      models: config.models,
      assignments: config.assignments
    };
    if (!user) return false;
    try {
      const request = {
        method: 'PUT',
        body: JSON.stringify({ ...settings, providers: settings.providers.map(({ id, type, endpoint }) => ({ id, type, endpoint })), apiKeys: effectiveKeys })
      };
      let response;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          response = await apiRequest('/auth/ai-settings', request);
          break;
        } catch (error) {
          const transient = !error.status || error.status >= 500;
          if (!transient || attempt === 3) throw error;
          await new Promise((resolve) => window.setTimeout(resolve, attempt * 400));
        }
      }
      setAiConfig(response.data);
      setProviderKeys({});
      setAiSaveStatus(t('saved'));
      return true;
    } catch (error) {
      const fieldDetails = Object.entries(error.fields || {}).flatMap(([field, messages]) =>
        (Array.isArray(messages) ? messages : [messages]).map((message) => `${field}: ${message}`)
      ).join('; ');
      const reason = [error.code || (error.status ? `HTTP ${error.status}` : 'network error'), fieldDetails].filter(Boolean).join(' · ');
      const requestId = error.requestId ? ` · ${t('requestId')}: ${error.requestId}` : '';
      lastAiSaveFailure.current = `${reason}${requestId}`;
      setAiSaveStatus(`${t('aiServerSaveFailed')} (${lastAiSaveFailure.current})`);
      return false;
    }
  }

  const testAssignedAiTasks = async () => {
    if (!user) return;
    const tasks = ['receipt', 'conversation'].filter((task) => aiConfig.assignments?.[task]);
    if (!tasks.length) {
      setAiTaskTestResults({});
      setAiSaveStatus(t('aiTestNoAssignedTasks'));
      return;
    }
    const configToTest = normalizeAiSettings(aiConfig);
    const keysToTest = { ...providerKeys };
    setAiTaskTestResults({});
    setIsTestingAiTasks(true);
    try {
      if (!await saveAiSettingsNow(configToTest, keysToTest)) {
        setAiTaskTestResults(Object.fromEntries(tasks.map((task) => [task, { status: 'error', code: 'AI_TEST_SAVE_FAILED', detail: lastAiSaveFailure.current, attempts: 0 }])));
        return;
      }
      for (const [taskIndex, task] of tasks.entries()) {
        let finalCode = 'AI_TEST_REQUEST_FAILED';
        let succeeded = false;
        let attemptsMade = 0;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          attemptsMade = attempt;
          setAiTaskTestProgress({ task, attempt, taskIndex: taskIndex + 1, totalTasks: tasks.length });
          try {
            await apiRequest('/auth/ai-settings/test', { method: 'POST', body: JSON.stringify({ task }) });
            succeeded = true;
            setAiTaskTestResults((current) => ({ ...current, [task]: { status: 'success', attempts: attempt } }));
            break;
          } catch (error) {
            finalCode = AI_TEST_ERROR_KEYS[error.code] ? error.code : (error.code === 'UNAUTHENTICATED' ? 'AI_TEST_SESSION_EXPIRED' : 'AI_TEST_REQUEST_FAILED');
            if (!AI_TEST_RETRYABLE_CODES.has(finalCode) || attempt === 3) break;
            await new Promise((resolve) => window.setTimeout(resolve, 500 * attempt));
          }
        }
        if (!succeeded) {
          setAiTaskTestResults((current) => ({ ...current, [task]: { status: 'error', code: finalCode, attempts: attemptsMade } }));
        }
      }
    } finally {
      setIsTestingAiTasks(false);
      setAiTaskTestProgress(null);
    }
  };
  const aiTaskDefinitions = [['receipt', 'aiTaskReceipts'], ['conversation', 'aiTaskConversation']];
  const assignedAiTaskCount = aiTaskDefinitions.filter(([task]) => aiConfig.assignments?.[task]).length;
  const allAssignedTasksPassed = assignedAiTaskCount > 0 && aiTaskDefinitions
    .filter(([task]) => aiConfig.assignments?.[task])
    .every(([task]) => aiTaskTestResults[task]?.status === 'success');

  async function saveTaskAssignments() {
    if (!allAssignedTasksPassed || isTestingAiTasks || taskAssignmentsSaved) return;
    if (await saveAiSettingsNow()) setTaskAssignmentsSaved(true);
  }

  return <section className="page-section"><PageTitle title={t('settings')} detail={t('settingsHint')} />
    <div className="panel settings-panel">
      <label className="settings-row"><span><strong>{t('language')}</strong><small>{t('languageHint')}</small></span><select value={language} onChange={(event) => setLanguage(event.target.value)}><option value="zh">&#x7B80;&#x4F53;&#x4E2D;&#x6587;</option><option value="en">English</option></select></label>
      <label className="settings-row"><span><strong>{t('theme')}</strong><small>{t('themeHint')}</small></span><select value={theme} onChange={(event) => setTheme(event.target.value)}><option value="light">{t('light')}</option><option value="dark">{t('dark')}</option></select></label>
      <label className="settings-row"><span><strong>{t('timeFormat')}</strong><small>{t('timeFormatHint')}</small></span><select value={timeFormat} onChange={(event) => setTimeFormat(event.target.value)}><option value="12">{t('hourFormat12')}</option><option value="24">{t('hourFormat24')}</option></select></label>
    </div>
    {user && <section className="ai-settings-section">
      <header className="ai-settings-heading"><div><div className="eyebrow">{t('aiManagement')}</div><h2>{t('aiConfiguration')}</h2><p>{t('aiSettingsHint')}</p></div>{aiSaveStatus && <small className="ai-save-status">{aiSaveStatus}</small>}</header>
      <article className="panel ai-config-card">
        <div className="ai-step-heading"><span>1</span><div><h3>{t('aiProviders')}</h3><p>{t('aiProviderHint')}</p></div></div>
        <form className="ai-provider-form" onSubmit={addProvider} noValidate>
          <label className="field"><span>{t('aiProvider')}</span><select value={providerDraft.type} onChange={(event) => setProviderDraft((current) => ({ ...current, type: event.target.value }))}>{providerTypes.map((type) => <option key={type} value={type}>{providerNames[type]}</option>)}</select></label>
          <label className="field"><span>{t('aiEndpoint')}</span><input type="url" value={providerDraft.endpoint} onChange={(event) => { setProviderDraft((current) => ({ ...current, endpoint: event.target.value })); setAiSaveStatus(''); }} onBlur={() => { if (providerDraft.endpoint.trim() && !normalizeEndpoint(providerDraft.endpoint)) setAiSaveStatus(t('aiEndpointInvalid')); }} placeholder="https://api.example.com/v1" /></label>
          <label className="field"><span>{t('aiApiKey')}</span><div className="ai-key-input"><input type={showProviderDraftKey ? 'text' : 'password'} autoComplete="new-password" value={providerDraft.apiKey} onChange={(event) => setProviderDraft((current) => ({ ...current, apiKey: event.target.value }))} placeholder={t('aiKeyPlaceholder')} /><button className="ai-visibility-button" type="button" aria-label={showProviderDraftKey ? t('hide') : t('show')} title={showProviderDraftKey ? t('hide') : t('show')} onClick={() => setShowProviderDraftKey((current) => !current)}><svg viewBox="0 0 24 24" aria-hidden="true">{showProviderDraftKey ? <><path d="M3 3l18 18" /><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a14.8 14.8 0 0 1-3.2 3.8" /><path d="M6.2 6.2C3.5 8 2 12 2 12s3.6 7 10 7a10 10 0 0 0 3-.5" /></> : <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>}</svg></button></div></label>
          <button className="secondary-button" type="submit" disabled={!providerDraft.type || !providerDraft.endpoint.trim() || !normalizeEndpoint(providerDraft.endpoint) || !providerDraft.apiKey.trim()}>{t('aiAddProvider')}</button>
        </form>
        {aiConfig.providers.length > 0 ? <div className="ai-provider-list">{aiConfig.providers.map((provider) => {
          const isEditing = editingProviderId === provider.id;
          const keyIsAvailable = provider.hasApiKey || Boolean(providerKeys[provider.id]?.trim());
          return <div className={`ai-provider-item ${isEditing ? 'is-editing' : ''}`} key={provider.id}>
            {!isEditing ? <div className="ai-provider-summary">
              <span className="ai-provider-summary-name"><strong>{providerNames[provider.type] || provider.type}</strong><small>{provider.endpoint}</small></span>
              <span className="ai-provider-summary-key"><small>{t('aiApiKey')}</small><strong>{keyIsAvailable ? '••••••••••••' : t('aiKeyNotSet')}</strong></span>
              <span className="ai-provider-summary-actions"><button className="ai-provider-edit-icon" type="button" aria-label={t('aiEditProvider')} title={t('aiEditProvider')} onClick={() => beginProviderEdit(provider)}>✎</button><button className="ai-remove-button" type="button" onClick={() => removeProvider(provider.id)}>{t('delete')}</button></span>
            </div> : <>
              <div className="ai-provider-title"><strong>{providerNames[provider.type] || provider.type}</strong><button className="icon-button close-editor ai-provider-close" type="button" aria-label={t('close')} title={t('close')} onClick={() => closeProviderEdit(provider.id)}>×</button></div>
              <label className="field"><span>{t('aiEndpoint')}</span><input type="url" value={editingEndpointDraft} onChange={(event) => { setEditingEndpointDraft(event.target.value); setAiSaveStatus(''); invalidateTaskTests(); }} onBlur={() => { const normalized = normalizeEndpoint(editingEndpointDraft); if (normalized) setEditingEndpointDraft(normalized); }} /></label>
              <label className="field"><span>{t('aiApiKey')}</span><div className="ai-key-input"><input type={showKeys[provider.id] ? 'text' : 'password'} autoComplete="new-password" value={providerKeys[provider.id] || ''} onChange={(event) => { setProviderKeys((current) => ({ ...current, [provider.id]: event.target.value })); invalidateTaskTests(); }} placeholder={provider.hasApiKey ? t('aiKeySaved') : t('aiKeyPlaceholder')} /><button className="ai-visibility-button" type="button" aria-label={showKeys[provider.id] ? t('hide') : t('show')} title={showKeys[provider.id] ? t('hide') : t('show')} onClick={() => setShowKeys((current) => ({ ...current, [provider.id]: !current[provider.id] }))}><svg viewBox="0 0 24 24" aria-hidden="true">{showKeys[provider.id] ? <><path d="M3 3l18 18" /><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a14.8 14.8 0 0 1-3.2 3.8" /><path d="M6.2 6.2C3.5 8 2 12 2 12s3.6 7 10 7a10 10 0 0 0 3-.5" /></> : <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>}</svg></button></div></label>
              <div className="ai-provider-edit-actions"><button className="ai-provider-save-button" type="button" onClick={() => finishProviderEdit(provider.id)}>{t('aiSaveChanges')}</button><button className="ai-provider-delete-button" type="button" onClick={() => removeProvider(provider.id)}>{t('delete')}</button></div>
            </>}
          </div>;
        })}</div> : <p className="ai-empty-state">{t('aiNoProviders')}</p>}
      </article>

      <article className="panel ai-config-card">
        <div className="ai-step-heading"><span>2</span><div><h3>{t('aiModels')}</h3><p>{t('aiModelHint')}</p></div></div>
        <form className="ai-model-form" onSubmit={addModel}>
          <label className="field"><span>{t('aiProvider')}</span><select value={modelDraft.providerId} onChange={(event) => setModelDraft((current) => ({ ...current, providerId: event.target.value }))} disabled={!aiConfig.providers.length}><option value="">{t('aiChooseProvider')}</option>{aiConfig.providers.map((provider) => <option key={provider.id} value={provider.id}>{providerNames[provider.type] || provider.type}</option>)}</select></label>
          <label className="field"><span>{t('aiModelName')}</span><input value={modelDraft.name} onChange={(event) => setModelDraft((current) => ({ ...current, name: event.target.value }))} placeholder={t('aiModelPlaceholder')} /></label>
          <label className="field"><span>{t('aiModelCustomName')}</span><input value={modelDraft.customName} onChange={(event) => setModelDraft((current) => ({ ...current, customName: event.target.value }))} placeholder={t('aiModelCustomNamePlaceholder')} /></label>
          <button className="secondary-button" type="submit" disabled={!aiConfig.providers.length || !modelDraft.name.trim() || !modelDraft.customName.trim()}>{t('aiAddModel')}</button>
        </form>
        {aiConfig.models.length > 0 && <div className="ai-model-list">{aiConfig.models.map((model) => {
          const provider = aiConfig.providers.find((item) => item.id === model.providerId);
          const isEditing = editingModelId === model.id;
          return <div className={`ai-model-item ${isEditing ? 'is-editing' : ''}`} key={model.id}>
            {!isEditing ? <>
              <span><strong>{model.customName || model.name}</strong><small>{model.name} · {providerNames[provider?.type] || provider?.type}</small></span>
              <div className="ai-model-actions"><button className="ai-provider-edit-icon" type="button" aria-label={t('aiEditModel')} title={t('aiEditModel')} onClick={() => beginModelEdit(model)}>✎</button><button className="ai-remove-button" type="button" onClick={() => removeModel(model.id)}>{t('delete')}</button></div>
            </> : <>
              <div className="ai-provider-title"><strong>{model.customName || model.name}</strong><button className="icon-button close-editor ai-provider-close" type="button" aria-label={t('close')} title={t('close')} onClick={closeModelEdit}>×</button></div>
              <div className="ai-model-edit-grid">
                <label className="field"><span>{t('aiProvider')}</span><select value={editingModelDraft.providerId} onChange={(event) => setEditingModelDraft((current) => ({ ...current, providerId: event.target.value }))}><option value="">{t('aiChooseProvider')}</option>{aiConfig.providers.map((item) => <option key={item.id} value={item.id}>{providerNames[item.type] || item.type}</option>)}</select></label>
                <label className="field"><span>{t('aiModelName')}</span><input value={editingModelDraft.name} onChange={(event) => setEditingModelDraft((current) => ({ ...current, name: event.target.value }))} /></label>
                <label className="field"><span>{t('aiModelCustomName')}</span><input value={editingModelDraft.customName} onChange={(event) => setEditingModelDraft((current) => ({ ...current, customName: event.target.value }))} /></label>
              </div>
              <div className="ai-provider-edit-actions"><button className="ai-provider-save-button" type="button" disabled={!editingModelDraft.providerId || !editingModelDraft.name.trim() || !editingModelDraft.customName.trim()} onClick={() => finishModelEdit(model.id)}>{t('aiSaveChanges')}</button><button className="ai-provider-delete-button" type="button" onClick={() => removeModel(model.id)}>{t('delete')}</button></div>
            </>}
          </div>;
        })}</div>}      </article>

      <article className="panel ai-config-card">
        <div className="ai-step-heading"><span>3</span><div><h3>{t('aiTaskAssignments')}</h3><p>{t('aiTaskHint')}</p></div></div>
        <div className={`ai-task-test-area ${isTestingAiTasks ? 'is-testing' : ''}`}>
          <div className="ai-task-list">{aiTaskDefinitions.map(([task, label]) => {
            const result = aiTaskTestResults[task];
            return <label className="ai-task-row" key={task}>
              <span className="ai-task-name"><span>{t(label)}</span>{result && <small className={`ai-task-test-result ${result.status}`} aria-label={result.status === 'success' ? t('aiTestSuccess') : undefined} title={result.status === 'success' ? t('aiTestSuccess') : undefined}>{result.status === 'success' ? <svg className="ai-task-success-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="m8 12 2.6 2.6L16.5 9" /></svg> : `${t(AI_TEST_ERROR_KEYS[result.code] || 'aiTestRequestFailed')}${result.detail ? ` (${result.detail})` : ''}`}</small>}</span>
              <select value={aiConfig.assignments[task] || ''} disabled={!aiConfig.models.length || isTestingAiTasks} onChange={(event) => { setAiConfig((current) => ({ ...current, assignments: { ...current.assignments, [task]: event.target.value } })); setAiTaskTestResults((current) => ({ ...current, [task]: undefined })); setTaskAssignmentsSaved(false); }}><option value="">{t('aiUnassigned')}</option>{aiConfig.models.map((model) => <option key={model.id} value={model.id}>{model.customName || model.name}</option>)}</select>
            </label>;
          })}</div>
          {isTestingAiTasks && <div className="ai-task-test-overlay" role="status" aria-live="polite"><span className="ai-test-spinner" aria-hidden="true" /><strong>{t('aiTestRunning')}</strong><small>{aiTaskTestProgress ? `${t(aiTaskTestProgress.task === 'receipt' ? 'aiTaskReceipts' : 'aiTaskConversation')} · ${aiTaskTestProgress.taskIndex}/${aiTaskTestProgress.totalTasks} · ${t('aiTestAttempt')} ${aiTaskTestProgress.attempt}/3` : t('aiTestPreparing')}</small></div>}
        </div>
        <div className="ai-provider-edit-actions"><button className="secondary-button ai-test-button" type="button" disabled={isTestingAiTasks || !assignedAiTaskCount} onClick={testAssignedAiTasks}>{isTestingAiTasks ? t('aiTestRunning') : t('aiTestAssignedTasks')}</button><button className={`ai-provider-save-button ${taskAssignmentsSaved ? 'is-saved' : ''}`} type="button" disabled={isTestingAiTasks || !allAssignedTasksPassed || taskAssignmentsSaved} onClick={saveTaskAssignments}>{taskAssignmentsSaved && <svg className="ai-save-success-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="m8 12 2.6 2.6L16.5 9" /></svg>}{taskAssignmentsSaved ? t('saved') : t('aiSaveChanges')}</button></div>
      </article>
    </section>}
    <article className="panel migration-option-card">
      <div><strong>{t('migrationOption')}</strong><p>{t('migrationOptionHint')}</p>{migrationNotice && <small className="migration-notice">{migrationNotice}</small>}</div>
      <button className="secondary-button" type="button" disabled={migrationWorking} onClick={() => void openFinanceMigration()}>{migrationWorking ? t('migrationWorking') : t('migrationOption')}</button>
    </article>
  </section>;
}
