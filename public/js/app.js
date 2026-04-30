// ============================================
// docpilot — Main Application
// ============================================

const pdfjsLib = window['pdfjs-dist/build/pdf'] || globalThis.pdfjsLib;

// Wait for PDF.js to be available
function waitForPdfJs() {
  return new Promise((resolve) => {
    const check = () => {
      if (window.pdfjsLib) {
        resolve(window.pdfjsLib);
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  });
}

// ---- State ----
let pdfDoc = null;
let pageTexts = [];   // pageTexts[i] = text of page i+1
let pageCount = 0;
let currentScale = 1.5;
let renderedPages = new Set();
let chatOpen = false;
let isAsking = false;
let activeHighlights = [];
let multiSourceActive = false;

// ---- DOM refs ----
const $ = (sel) => document.querySelector(sel);
const emptyState = $('#empty-state');
const viewerContainer = $('#viewer-container');
const pdfViewer = $('#pdf-viewer');
const dropOverlay = $('#drop-overlay');
const uploadZone = $('#upload-zone');
const fileInput = $('#file-input');
const newFileInput = $('#new-file-input');
const newDocBtn = $('#new-doc-btn');
const docTitle = $('#doc-title');
const pageIndicator = $('#page-indicator');
const prevPageBtn = $('#prev-page');
const nextPageBtn = $('#next-page');
const chatFab = $('#chat-fab');
const chatPanel = $('#chat-panel');
const chatMessages = $('#chat-messages');
const chatForm = $('#chat-form');
const chatInput = $('#chat-input');
const chatSend = $('#chat-send');
const chatClose = $('#chat-close');
const chatIconOpen = $('#chat-icon-open');
const chatIconClose = $('#chat-icon-close');
const multiSourceOverlay = $('#multi-source-overlay');
const multiSourceContent = $('#multi-source-content');
const multiSourceCount = $('#multi-source-count');
const multiSourceCloseBtn = $('#multi-source-close');

// ============================================
// PDF Loading & Rendering
// ============================================

async function loadPDF(arrayBuffer, fileName) {
  const lib = await waitForPdfJs();
  lib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';

  const loadingTask = lib.getDocument({ data: arrayBuffer });
  pdfDoc = await loadingTask.promise;
  pageCount = pdfDoc.numPages;
  pageTexts = new Array(pageCount).fill('');
  renderedPages = new Set();
  activeHighlights = [];

  docTitle.textContent = fileName || 'Document';
  updatePageIndicator();

  // Show viewer, hide empty state
  emptyState.classList.add('hidden');
  viewerContainer.classList.remove('hidden');

  // Clear previous pages
  pdfViewer.innerHTML = '';

  // Render all pages
  for (let i = 1; i <= pageCount; i++) {
    await renderPage(i);
  }
}

async function renderPage(pageNum) {
  if (renderedPages.has(pageNum)) return;
  renderedPages.add(pageNum);

  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: currentScale });

  // Wrapper div
  const wrapper = document.createElement('div');
  wrapper.className = 'pdf-page-wrapper';
  wrapper.id = `page-${pageNum}`;
  wrapper.dataset.page = pageNum;
  wrapper.style.width = viewport.width + 'px';
  wrapper.style.height = viewport.height + 'px';

  // Canvas
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = viewport.width * (window.devicePixelRatio || 1);
  canvas.height = viewport.height * (window.devicePixelRatio || 1);
  canvas.style.width = viewport.width + 'px';
  canvas.style.height = viewport.height + 'px';
  ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);

  wrapper.appendChild(canvas);

  // Text layer
  const textLayerDiv = document.createElement('div');
  textLayerDiv.className = 'text-layer';
  wrapper.appendChild(textLayerDiv);

  pdfViewer.appendChild(wrapper);

  // Render canvas
  await page.render({ canvasContext: ctx, viewport }).promise;

  // Render text layer
  const textContent = await page.getTextContent();
  let pageText = '';

  textContent.items.forEach((item) => {
    if (!item.str) return;
    pageText += item.str + ' ';

    const tx = pdfjsLib?.Util?.transform?.(viewport.transform, item.transform)
      || transformItem(viewport, item);

    const span = document.createElement('span');
    span.textContent = item.str;
    span.dataset.text = item.str;
    span.style.left = tx[4] + 'px';
    span.style.top = (tx[5] - item.height * currentScale) + 'px';
    span.style.fontSize = (item.height * currentScale) + 'px';

    // Approximate width scaling
    const textWidth = item.width * currentScale;
    if (item.str.length > 0 && textWidth > 0) {
      span.style.width = textWidth + 'px';
      // Don't letter-space; use scaleX to fit
      const measuredWidth = measureTextWidth(item.str, item.height * currentScale);
      if (measuredWidth > 0) {
        span.style.transform = `scaleX(${textWidth / measuredWidth})`;
      }
    }

    textLayerDiv.appendChild(span);
  });

  pageTexts[pageNum - 1] = pageText.trim();
}

// Fallback transform calculation
function transformItem(viewport, item) {
  const [a, b, c, d, e, f] = item.transform;
  const [va, vb, vc, vd, ve, vf] = viewport.transform;
  return [
    a * va + b * vc,
    a * vb + b * vd,
    c * va + d * vc,
    c * vb + d * vd,
    e * va + f * vc + ve,
    e * vb + f * vd + vf,
  ];
}

// Measure text width helper
const _measureCanvas = document.createElement('canvas').getContext('2d');
function measureTextWidth(text, fontSize) {
  _measureCanvas.font = `${fontSize}px Inter, sans-serif`;
  return _measureCanvas.measureText(text).width;
}

// ---- Page navigation ----
function updatePageIndicator() {
  pageIndicator.textContent = `Page 1 / ${pageCount}`;
  prevPageBtn.disabled = true;
  nextPageBtn.disabled = pageCount <= 1;
}

function getCurrentVisiblePage() {
  const scrollTop = pdfViewer.scrollTop;
  const viewerMid = scrollTop + pdfViewer.clientHeight / 3;
  let best = 1;
  for (let i = 1; i <= pageCount; i++) {
    const el = document.getElementById(`page-${i}`);
    if (el && el.offsetTop <= viewerMid) best = i;
  }
  return best;
}

pdfViewer.addEventListener('scroll', () => {
  const p = getCurrentVisiblePage();
  pageIndicator.textContent = `Page ${p} / ${pageCount}`;
  prevPageBtn.disabled = p <= 1;
  nextPageBtn.disabled = p >= pageCount;
});

prevPageBtn.addEventListener('click', () => {
  const p = getCurrentVisiblePage();
  if (p > 1) scrollToPage(p - 1);
});

nextPageBtn.addEventListener('click', () => {
  const p = getCurrentVisiblePage();
  if (p < pageCount) scrollToPage(p + 1);
});

function scrollToPage(pageNum) {
  const el = document.getElementById(`page-${pageNum}`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// ============================================
// Drag & Drop + File Selection
// ============================================

let dragCounter = 0;

document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragCounter++;
  if (dragCounter === 1) dropOverlay.classList.remove('hidden');
});

document.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    dropOverlay.classList.add('hidden');
  }
});

document.addEventListener('dragover', (e) => {
  e.preventDefault();
});

document.addEventListener('drop', (e) => {
  e.preventDefault();
  dragCounter = 0;
  dropOverlay.classList.add('hidden');

  const file = e.dataTransfer.files[0];
  if (file && file.type === 'application/pdf') {
    handleFile(file);
  }
});

uploadZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
});

newDocBtn.addEventListener('click', () => newFileInput.click());
newFileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
});

async function handleFile(file) {
  if (file.type !== 'application/pdf') return;
  const buffer = await file.arrayBuffer();
  await loadPDF(buffer, file.name);
}

// ============================================
// Chat Interface
// ============================================

function toggleChat() {
  chatOpen = !chatOpen;
  chatPanel.classList.toggle('hidden', !chatOpen);
  chatFab.classList.toggle('open', chatOpen);
  chatIconOpen.classList.toggle('hidden', chatOpen);
  chatIconClose.classList.toggle('hidden', !chatOpen);
  if (chatOpen) chatInput.focus();
}

chatFab.addEventListener('click', toggleChat);
chatClose.addEventListener('click', toggleChat);

function addMessage(role, content) {
  const div = document.createElement('div');
  div.className = `chat-message ${role}`;
  div.innerHTML = `<div class="message-content">${content}</div>`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}

function addLoadingMessage() {
  const div = document.createElement('div');
  div.className = 'chat-message assistant';
  div.id = 'loading-msg';
  div.innerHTML = `<div class="message-content"><div class="loading-dots"><span></span><span></span><span></span></div></div>`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}

function removeLoadingMessage() {
  const el = document.getElementById('loading-msg');
  if (el) el.remove();
}

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const question = chatInput.value.trim();
  if (!question || isAsking) return;

  // Check if document is loaded
  if (!pdfDoc) {
    addMessage('user', escapeHtml(question));
    addMessage('assistant', 'Please upload a PDF document first! Drag and drop one onto the page or click the upload area.');
    chatInput.value = '';
    return;
  }

  addMessage('user', escapeHtml(question));
  chatInput.value = '';
  isAsking = true;
  chatSend.disabled = true;
  addLoadingMessage();

  // Clear previous highlights and dismiss multi-source view
  clearHighlights();
  dismissMultiSourceView();

  try {
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, pages: pageTexts }),
    });

    removeLoadingMessage();

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      addMessage('assistant', `Sorry, something went wrong: ${escapeHtml(err.error || 'Unknown error')}. Please try again.`);
      return;
    }

    const data = await res.json();
    let answerHtml = escapeHtml(data.answer || 'I couldn\'t find an answer.');

    // Add source chips if we have sources
    if (data.sources && data.sources.length > 0) {
      answerHtml += '<br/><br/>';

      // Add "View all N sources" chip when 2+ sources
      if (data.sources.length >= 2) {
        answerHtml += `<span class="source-chip-multi" onclick="window.__showMultiSource()"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg> View all ${data.sources.length} sources</span>`;
      }

      data.sources.forEach((src, i) => {
        answerHtml += `<span class="source-chip" data-source-idx="${i}" onclick="window.__goToSource(${i})">📄 Page ${src.page}</span>`;
      });

      // Store sources globally for click handler
      window.__currentSources = data.sources;

      // Highlight sources in the document
      highlightSources(data.sources);

      // Auto-trigger multi-source view for 2+ sources
      if (data.sources.length >= 2) {
        // Small delay so the message renders first
        setTimeout(() => showMultiSourceView(data.sources), 300);
      } else if (data.sources[0] && data.sources[0].page) {
        scrollToPage(data.sources[0].page);
      }
    }

    addMessage('assistant', answerHtml);
  } catch (err) {
    removeLoadingMessage();
    addMessage('assistant', 'Network error — please check your connection and try again.');
    console.error(err);
  } finally {
    isAsking = false;
    chatSend.disabled = false;
  }
});

// ============================================
// Source Highlighting
// ============================================

window.__goToSource = function(idx) {
  const sources = window.__currentSources;
  if (!sources || !sources[idx]) return;
  const src = sources[idx];
  scrollToPage(src.page);
  clearHighlights();
  highlightSources([src]);
};

function clearHighlights() {
  activeHighlights.forEach((el) => el.classList.remove('highlight'));
  activeHighlights = [];
}

function highlightSources(sources) {
  sources.forEach((src) => {
    if (!src.text || !src.page) return;
    const pageEl = document.getElementById(`page-${src.page}`);
    if (!pageEl) return;

    const textLayer = pageEl.querySelector('.text-layer');
    if (!textLayer) return;

    const spans = textLayer.querySelectorAll('span');

    // Normalize source text for matching
    const sourceNorm = normalizeText(src.text);

    // Try to find matching spans by building a running text
    // and matching the source text within it
    const spanTexts = Array.from(spans).map(s => s.dataset.text || s.textContent);
    const runningText = spanTexts.map(normalizeText).join(' ');

    const matchStart = runningText.indexOf(sourceNorm);
    if (matchStart !== -1) {
      // Find which spans correspond to this range
      let charPos = 0;
      for (let i = 0; i < spans.length; i++) {
        const spanNorm = normalizeText(spanTexts[i]);
        const spanEnd = charPos + spanNorm.length;

        // Check if this span overlaps with our match
        if (spanEnd > matchStart && charPos < matchStart + sourceNorm.length) {
          spans[i].classList.add('highlight');
          activeHighlights.push(spans[i]);
        }

        charPos = spanEnd + 1; // +1 for the space we joined with
      }
      return;
    }

    // Fallback: try to match individual words from the source
    // (handles cases where LLM slightly modified the quote)
    const sourceWords = sourceNorm.split(/\s+/).filter(w => w.length > 3);
    if (sourceWords.length === 0) return;

    const wordSet = new Set(sourceWords);
    let matchedCount = 0;
    const candidates = [];

    spans.forEach((span) => {
      const words = normalizeText(span.dataset.text || span.textContent).split(/\s+/);
      const hasMatch = words.some(w => wordSet.has(w));
      if (hasMatch) {
        candidates.push(span);
        matchedCount++;
      }
    });

    // Only highlight if we matched a reasonable portion
    if (matchedCount >= Math.min(3, sourceWords.length * 0.3)) {
      candidates.forEach(span => {
        span.classList.add('highlight');
        activeHighlights.push(span);
      });
    }
  });
}

// ============================================
// Multi-Source Split View
// ============================================

window.__showMultiSource = function() {
  const sources = window.__currentSources;
  if (sources && sources.length >= 2) {
    showMultiSourceView(sources);
  }
};

multiSourceCloseBtn.addEventListener('click', () => {
  dismissMultiSourceView();
});

function dismissMultiSourceView() {
  if (!multiSourceActive) return;
  multiSourceActive = false;
  multiSourceOverlay.classList.add('hidden');
  multiSourceContent.innerHTML = '';
  multiSourceContent.className = 'multi-source-content';
}

async function showMultiSourceView(sources) {
  if (!pdfDoc || sources.length < 2) return;

  multiSourceActive = true;
  multiSourceContent.innerHTML = '';

  // Pick layout class
  const count = sources.length;
  multiSourceCount.textContent = `${count} source locations`;

  multiSourceContent.className = 'multi-source-content';
  if (count <= 4) {
    multiSourceContent.classList.add(`grid-${count}`);
  } else {
    multiSourceContent.classList.add('strip-layout');
  }

  multiSourceOverlay.classList.remove('hidden');

  // Create panes
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    const pane = await createSourcePane(src, i);
    multiSourceContent.appendChild(pane);
  }
}

async function createSourcePane(src, idx) {
  const pane = document.createElement('div');
  pane.className = 'multi-source-pane';

  // Header
  const header = document.createElement('div');
  header.className = 'multi-source-pane-header';

  const label = document.createElement('span');
  label.className = 'multi-source-pane-label';
  label.textContent = `📄 Page ${src.page}`;

  const badge = document.createElement('span');
  badge.className = 'multi-source-pane-badge';
  badge.textContent = `Source ${idx + 1}`;

  header.appendChild(label);
  header.appendChild(badge);
  pane.appendChild(header);

  // Canvas area with rendered page
  const canvasArea = document.createElement('div');
  canvasArea.className = 'multi-source-pane-canvas';

  try {
    const page = await pdfDoc.getPage(src.page);
    // Calculate scale to fit the pane width (assume ~300px)
    const baseViewport = page.getViewport({ scale: 1 });
    const paneScale = 1.2; // reasonable quality
    const viewport = page.getViewport({ scale: paneScale });

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = viewport.width * dpr;
    canvas.height = viewport.height * dpr;
    canvas.style.width = viewport.width + 'px';
    canvas.style.height = viewport.height + 'px';
    ctx.scale(dpr, dpr);

    canvasArea.appendChild(canvas);
    canvasArea.style.width = viewport.width + 'px';
    canvasArea.style.height = viewport.height + 'px';

    // Add text layer for highlighting
    const textLayerDiv = document.createElement('div');
    textLayerDiv.className = 'text-layer';
    canvasArea.appendChild(textLayerDiv);

    // Render asynchronously
    page.render({ canvasContext: ctx, viewport }).promise.then(async () => {
      // Render text layer and highlight
      const textContent = await page.getTextContent();
      renderTextLayerForPane(textContent, textLayerDiv, viewport, paneScale);

      // Highlight the source text in this pane's text layer
      if (src.text) {
        highlightInTextLayer(textLayerDiv, src.text);
        scrollPaneToHighlight(canvasArea);
      }
    });
  } catch (e) {
    canvasArea.innerHTML = '<p style="padding: 1rem; color: var(--gray-400); font-size: 0.8rem;">Could not render page</p>';
  }

  pane.appendChild(canvasArea);

  // Snippet at bottom
  if (src.text) {
    const snippet = document.createElement('div');
    snippet.className = 'multi-source-pane-snippet';
    const p = document.createElement('p');
    p.textContent = `"${src.text}"`;
    snippet.appendChild(p);
    pane.appendChild(snippet);
  }

  // Click to jump to source in main viewer
  pane.addEventListener('click', () => {
    dismissMultiSourceView();
    clearHighlights();
    highlightSources([src]);
    scrollToPage(src.page);
  });

  return pane;
}

function renderTextLayerForPane(textContent, textLayerDiv, viewport, scale) {
  textContent.items.forEach((item) => {
    if (!item.str) return;

    const tx = pdfjsLib?.Util?.transform?.(viewport.transform, item.transform)
      || transformItem(viewport, item);

    const span = document.createElement('span');
    span.textContent = item.str;
    span.dataset.text = item.str;
    span.style.left = tx[4] + 'px';
    span.style.top = (tx[5] - item.height * scale) + 'px';
    span.style.fontSize = (item.height * scale) + 'px';

    const textWidth = item.width * scale;
    if (item.str.length > 0 && textWidth > 0) {
      span.style.width = textWidth + 'px';
      const measuredWidth = measureTextWidth(item.str, item.height * scale);
      if (measuredWidth > 0) {
        span.style.transform = `scaleX(${textWidth / measuredWidth})`;
      }
    }

    textLayerDiv.appendChild(span);
  });
}

function highlightInTextLayer(textLayerDiv, sourceText) {
  const spans = textLayerDiv.querySelectorAll('span');
  const sourceNorm = normalizeText(sourceText);

  const spanTexts = Array.from(spans).map(s => s.dataset.text || s.textContent);
  const runningText = spanTexts.map(normalizeText).join(' ');
  const matchStart = runningText.indexOf(sourceNorm);

  if (matchStart !== -1) {
    let charPos = 0;
    for (let i = 0; i < spans.length; i++) {
      const spanNorm = normalizeText(spanTexts[i]);
      const spanEnd = charPos + spanNorm.length;
      if (spanEnd > matchStart && charPos < matchStart + sourceNorm.length) {
        spans[i].classList.add('highlight');
      }
      charPos = spanEnd + 1;
    }
    return;
  }

  // Fallback: word matching
  const sourceWords = sourceNorm.split(/\s+/).filter(w => w.length > 3);
  if (sourceWords.length === 0) return;
  const wordSet = new Set(sourceWords);
  let matchedCount = 0;
  const candidates = [];
  spans.forEach((span) => {
    const words = normalizeText(span.dataset.text || span.textContent).split(/\s+/);
    if (words.some(w => wordSet.has(w))) {
      candidates.push(span);
      matchedCount++;
    }
  });
  if (matchedCount >= Math.min(3, sourceWords.length * 0.3)) {
    candidates.forEach(span => span.classList.add('highlight'));
  }
}

function scrollPaneToHighlight(canvasArea) {
  // Find first highlighted span and scroll it into view within the pane
  const highlighted = canvasArea.querySelector('.highlight');
  if (highlighted) {
    const paneRect = canvasArea.getBoundingClientRect();
    const highlightRect = highlighted.getBoundingClientRect();
    // Calculate offset relative to the canvas area's scroll
    const offsetTop = highlighted.offsetTop - canvasArea.offsetTop;
    // Scroll so highlight is centered in the pane
    const scrollTarget = offsetTop - canvasArea.clientHeight / 3;
    canvasArea.scrollTop = Math.max(0, scrollTarget);
  }
}

function normalizeText(text) {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============================================
// PDF.js loader (CDN module import)
// ============================================

async function initPdfJs() {
  // PDF.js is loaded as a module via script tag; set up the global
  try {
    const pdfjs = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs');
    window.pdfjsLib = pdfjs;
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';
  } catch (e) {
    console.error('Failed to load PDF.js:', e);
  }
}

// Initialize
initPdfJs();
