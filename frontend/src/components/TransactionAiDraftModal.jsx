import { useState } from 'react';
import { apiRequest } from '../api/client.js';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES = 4;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve({ id: crypto.randomUUID(), name: file.name, data: reader.result }) : reject(new Error('AI_DRAFT_INVALID_IMAGE'));
    reader.onerror = () => reject(new Error('AI_DRAFT_INVALID_IMAGE'));
    reader.readAsDataURL(file);
  });
}

export function TransactionAiDraftModal({ noteImages = [], account, type, language, t, onClose, onDraft, onOcrResult }) {
  const [images, setImages] = useState([]);
  const [prompt, setPrompt] = useState('');
  const [recognitionMode, setRecognitionMode] = useState('ai');
  const [ocrLanguage, setOcrLanguage] = useState(language === 'zh' ? 'chi_sim+eng' : 'eng');
  const [ocrText, setOcrText] = useState('');
  const [ocrProgress, setOcrProgress] = useState(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  async function addImages(event) {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    if (!files.length) return;
    const currentCount = images.length + noteImages.length;
    if (currentCount + files.length > MAX_IMAGES) {
      setError(t('aiDraftImageLimit'));
      return;
    }
    if (files.some((file) => !IMAGE_TYPES.includes(file.type) || file.size > MAX_IMAGE_BYTES)) {
      setError(t('imageTypeError'));
      return;
    }
    try {
      const selected = await Promise.all(files.map(readImage));
      setImages((current) => [...current, ...selected]);
      setOcrText('');
      setOcrProgress(null);
      setError('');
    } catch {
      setError(t('imageTypeError'));
    }
  }

  async function createDraft(event) {
    event.preventDefault();
    if (working) return;
    if (recognitionMode === 'ocr') {
      if (ocrText.trim()) {
        const applied = onOcrResult?.({ text: ocrText.trim(), addedImages: images.map((image) => image.data) });
        if (applied === false) {
          setError(t('ocrNoteLimit'));
          return;
        }
        onClose();
        return;
      }
      const sourceImages = [...noteImages, ...images.map((image) => image.data)];
      if (!sourceImages.length) {
        setError(t('ocrNoImages'));
        return;
      }
      setWorking(true);
      setError('');
      setOcrProgress({ stage: 'prepare', progress: 0 });
      try {
        const { recognizeImagesLocally } = await import('../utils/ocr.js');
        const text = await recognizeImagesLocally(sourceImages, ocrLanguage, setOcrProgress);
        setOcrText(text);
        setOcrProgress({ stage: 'complete', progress: 1 });
      } catch (failure) {
        const errorKey = failure.message === 'OCR_NO_TEXT' ? 'ocrNoText'
          : ['OCR_IMAGE_LOAD_FAILED', 'OCR_IMAGE_EXTERNAL_URL', 'OCR_IMAGE_INVALID'].includes(failure.message) ? 'ocrImageLoadFailed'
            : 'ocrFailed';
        setError(t(errorKey));
        setOcrProgress(null);
      } finally {
        setWorking(false);
      }
      return;
    }
    setWorking(true);
    setError('');
    try {
      const response = await apiRequest('/auth/assistant/transaction-draft', {
        method: 'POST',
        body: JSON.stringify({
          accountId: account.id,
          type,
          prompt,
          existingImages: noteImages,
          images: images.map((image) => image.data)
        })
      });
      await onDraft({ ...response.data, addedImages: images.map((image) => image.data) });
    } catch (failure) {
      const errorKeys = {
        AI_TEST_ASSIGNMENT_MISSING: 'aiDraftNoModel',
        AI_TEST_MODEL_NOT_FOUND: 'aiTestModelNotFound',
        AI_TEST_PROVIDER_NOT_FOUND: 'aiTestProviderNotFound',
        AI_TEST_KEY_MISSING: 'aiTestKeyMissing',
        AI_TOOL_CALL_UNSUPPORTED: 'aiDraftModelUnsupported',
        AI_TOOL_CALL_NOT_SELECTED: 'aiDraftNoResult',
        AI_TEST_AUTH_FAILED: 'aiTestAuthFailed',
        AI_TEST_RATE_LIMITED: 'aiTestRateLimited',
        AI_TEST_TIMEOUT: 'aiTestTimeout',
        AI_TEST_NETWORK: 'aiTestNetwork',
        AI_TEST_INVALID_RESPONSE: 'aiTestInvalidResponse',
        AI_DRAFT_INVALID_INPUT: 'aiDraftInvalidInput',
        AI_DRAFT_INVALID_IMAGE: 'aiDraftInvalidImage',
        AI_DRAFT_IMAGE_NOT_FOUND: 'aiDraftImageNotFound',
        AI_DRAFT_ACCOUNT_NOT_FOUND: 'aiDraftInvalidInput',
        AI_DRAFT_PROMPT_UNAVAILABLE: 'aiDraftFailed',
        AI_TEST_REQUEST_REJECTED: 'aiDraftModelUnsupported'
      };
      setError(t(errorKeys[failure.code] || 'aiDraftFailed'));
    } finally {
      setWorking(false);
    }
  }

  return <div className="ai-draft-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !working) onClose(); }}>
    <section className="panel ai-draft-modal" role="dialog" aria-modal="true" aria-labelledby="ai-draft-title">
      <header className="ai-draft-heading"><div><span className="eyebrow">{t('aiDraftEyebrow')}</span><h2 id="ai-draft-title">{t('aiDraftTitle')}</h2><p>{t('aiDraftHint')}</p></div><button className="icon-button ai-draft-close" type="button" onClick={onClose} disabled={working} aria-label={t('close')}>×</button></header>
      <form onSubmit={createDraft}>
        <fieldset className="recognition-mode-field">
          <legend>{t('recognitionMethod')}</legend>
          <div className="recognition-mode-options" role="group" aria-label={t('recognitionMethod')}>
            <button className={`recognition-mode-option ${recognitionMode === 'ai' ? 'selected' : ''}`} type="button" aria-pressed={recognitionMode === 'ai'} onClick={() => { setRecognitionMode('ai'); setError(''); setOcrProgress(null); }}>
              <strong>{t('aiRecognitionOption')}</strong><small>{t('aiRecognitionOptionHint')}</small>
            </button>
            <button className={`recognition-mode-option ${recognitionMode === 'ocr' ? 'selected' : ''}`} type="button" aria-pressed={recognitionMode === 'ocr'} onClick={() => { setRecognitionMode('ocr'); setError(''); setOcrProgress(null); }}>
              <strong>{t('ocrRecognitionOption')}</strong><small>{t('ocrRecognitionOptionHint')}</small>
            </button>
          </div>
          {recognitionMode === 'ocr' && <p className="recognition-mode-notice" role="status">{t('ocrLocalPrivacy')}</p>}
        </fieldset>
        {recognitionMode === 'ai' && <label className="field ai-draft-prompt"><span>{t('message')}</span><textarea rows="3" maxLength="3000" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={t('aiDraftPromptPlaceholder')} /></label>}
        {recognitionMode === 'ocr' && <label className="field"><span>{t('ocrLanguage')}</span><select value={ocrLanguage} onChange={(event) => { setOcrLanguage(event.target.value); setOcrText(''); setOcrProgress(null); setError(''); }}><option value="eng">{t('ocrEnglish')}</option><option value="chi_sim">{t('ocrSimplifiedChinese')}</option><option value="chi_sim+eng">{t('ocrChineseEnglish')}</option></select></label>}
        <div className="field ai-draft-images"><span>{t('aiDraftImages')}</span>
          <div className="ai-draft-image-list">
            {noteImages.map((image, index) => <div className="ai-draft-image-item" key={`existing-${index}`}><img src={image} alt={t('noteImage')} /><span>{t('aiDraftCurrentNoteImage')}</span></div>)}
            {images.map((image) => <div className="ai-draft-image-item" key={image.id}><img src={image.data} alt={image.name} /><span title={image.name}>{image.name}</span><button type="button" onClick={() => setImages((current) => current.filter((item) => item.id !== image.id))} aria-label={t('removeImage')}>×</button></div>)}
            {(images.length + noteImages.length) < MAX_IMAGES && <label className="secondary-button ai-draft-add-image">+ {t('aiDraftAddImage')}<input type="file" accept={IMAGE_TYPES.join(',')} multiple onChange={addImages} /></label>}
          </div>
          <small>{t('aiDraftImageLimit')}</small>
        </div>
        {recognitionMode === 'ocr' && ocrProgress && <div className="ocr-progress" role="status"><div><span>{t(`ocrProgress${ocrProgress.stage[0].toUpperCase()}${ocrProgress.stage.slice(1)}`)}</span><span>{Math.round(ocrProgress.progress * 100)}%</span></div><progress max="1" value={ocrProgress.progress} /></div>}
        {recognitionMode === 'ocr' && ocrText && <label className="field ocr-result-field"><span>{t('ocrResult')}</span><textarea rows="8" value={ocrText} onChange={(event) => { setOcrText(event.target.value); setError(''); }} /></label>}
        {error && <p className="ai-draft-error" role="alert">{error}</p>}
        <footer className="ai-draft-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={working}>{t('cancel')}</button><button className="primary-button" type="submit" disabled={working || (recognitionMode === 'ocr' && !ocrText && !noteImages.length && !images.length)}>{working ? <><span className="ai-test-spinner" aria-hidden="true" />{t('aiDraftWorking')}</> : recognitionMode === 'ocr' ? ocrText ? t('ocrInsertNote') : t('ocrRecognitionRun') : t('aiDraftRun')}</button></footer>
      </form>
    </section>
  </div>;
}
