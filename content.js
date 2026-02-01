// ============================================
// CONTENT SCRIPT: BROAD EXTRACTOR + DEEP IMAGES
// ============================================

console.log('Chat Exporter: Script Loaded');

// --- 1. UTILITIES & IMAGE FETCHING ---

function captureImageFromDOM(src) {
  const allImages = document.getElementsByTagName('img');
  let img = null;
  for (let i = 0; i < allImages.length; i++) {
    if (allImages[i].src === src) {
      img = allImages[i];
      break;
    }
  }
  if (!img) return null;

  try {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    if (canvas.width === 0 || canvas.height === 0) return null;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.8);
  } catch (e) {
    return null;
  }
}

async function getBase64FromUrl(url) {
  const canvasData = captureImageFromDOM(url);
  if (canvasData) return canvasData;

  try {
    if (url.startsWith('blob:')) {
      const response = await fetch(url);
      const blob = await response.blob();
      return await blobToBase64(blob);
    }
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(url, { signal: controller.signal, cache: 'force-cache' }); // No credentials
    clearTimeout(id);
    if (!response.ok) throw new Error('Fetch failed');
    const blob = await response.blob();
    return await blobToBase64(blob);
  } catch (e) {
    return null;
  }
}

function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

function cleanText(text) {
  if (!text) return '';
  return text.replace(/\[\s*\d+(?::\d+)?\s*\]/g, '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
}

// --- 2. DOM PARSER (DEEP SCAN) ---

function parseDomToBlocks(root) {
  const blocks = [];

  // 1. Extract Images FIRST (Deep Scan)
  // We scan the entire root node for images before processing text
  const images = root.querySelectorAll('img');
  for (const img of images) {
    if (img.width > 40 && !img.src.includes('data:image/svg')) {
      blocks.push({ type: 'image', src: img.src });
    }
  }

  // 2. Process Text/Code Structure
  function traverse(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = cleanText(node.textContent);
      if (text) blocks.push({ type: 'text', content: text });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName.toLowerCase();

    // Skip images in traversal (captured above) to avoid duplicates? 
    // Actually, we should keep them if they are inline, but for safety lets de-dupe later.

    if (tag === 'pre') {
      const codeEl = node.querySelector('code') || node;
      const lang = (codeEl.className || '').replace('language-', '').toUpperCase() || 'CODE';
      blocks.push({ type: 'code', lang: lang, content: codeEl.innerText });
      // Don't traverse children of pre
      return;
    }

    if (tag === 'table') {
      let tableText = '';
      node.querySelectorAll('tr').forEach((tr, i) => {
        const cells = Array.from(tr.querySelectorAll('th, td')).map(td => cleanText(td.innerText));
        tableText += '| ' + cells.join(' | ') + ' |\n';
        if (i === 0) tableText += '| ' + cells.map(() => '---').join(' | ') + ' |\n';
      });
      blocks.push({ type: 'code', lang: 'TABLE', content: tableText });
      return;
    }

    if (/^h[1-6]$/.test(tag)) {
      blocks.push({ type: 'header', content: cleanText(node.innerText) });
      return;
    }

    // Check for "User Query" text containers specifically
    if (node.classList.contains('user-query') || node.getAttribute('data-test-id') === 'user-query') {
      // Isolate this block
    }

    for (const child of node.childNodes) traverse(child);
    if (tag === 'p' || tag === 'div' || tag === 'br') blocks.push({ type: 'break' });
  }

  // Only traverse if we haven't just grabbed images. 
  // Actually, standard traversal is fine, we just need to dedupe images.
  traverse(root);

  // Dedupe logic: If an image src is in blocks twice, keep one.
  // Prioritize keeping the ones found in Deep Scan (first) or Traversal?
  // Let's filter blocks: Keep unique Image SRCs.
  const seenImgs = new Set();
  const uniqueBlocks = [];
  for (const b of blocks) {
    if (b.type === 'image') {
      if (seenImgs.has(b.src)) continue;
      seenImgs.add(b.src);
    }
    uniqueBlocks.push(b);
  }

  return uniqueBlocks;
}

// --- 3. EXTRACTORS (BROAD SPECTRUM) ---

async function extractGeminiContent() {
  // Strategy: Try Broad Selectors for "Message Containers"
  // 1. Standard "Turn" container
  let messageNodes = document.querySelectorAll('message-content, .message-content, [class*="conversation-turn"]');

  // 2. Fallback: Search for User Query / Model Response containers directly
  if (messageNodes.length === 0) {
    messageNodes = document.querySelectorAll('[data-test-id="user-query"], [data-test-id="model-response"], .user-query, .model-response');
  }

  // 3. Fallback: Search for generic scroll items
  if (messageNodes.length === 0) {
    // Last resort: Look for main children
    const main = document.querySelector('main');
    if (main) messageNodes = main.children;
  }

  const messages = [];

  for (const node of messageNodes) {
    // Heuristic for Role
    let role = 'assistant';
    const text = node.innerText || '';

    // Check for User Signals
    if (
      node.closest('.user-message') ||
      node.classList.contains('user-query') ||
      node.getAttribute('data-test-id') === 'user-query' ||
      node.hasAttribute('data-is-user')
    ) {
      role = 'user';
    }
    // Fallback: Check if it LOOKS like a user message (short, no markdown usually)
    // (Skipping hazardous guess)

    const blocks = parseDomToBlocks(node);

    // Async Image Load
    for (const block of blocks) {
      if (block.type === 'image') block.base64 = await getBase64FromUrl(block.src);
    }

    if (blocks.length > 0) messages.push({ role, blocks });
  }

  return { title: document.title.replace('Gemini', '').trim(), messages };
}

// keep ChatGPT extract same (it was working mostly, just images were failing)
async function extractChatGPTContent() {
  const articles = document.querySelectorAll('article');
  const messages = [];
  for (const article of articles) {
    const isUser = article.querySelector('[data-message-author-role="user"]');
    const role = isUser ? 'user' : 'assistant';
    const contentNode = article.querySelector('.markdown') || article.querySelector('[data-message-author-role] + div');

    if (contentNode) {
      const blocks = parseDomToBlocks(contentNode);
      // Extra Image Sweep
      const extraImagesNodes = article.querySelectorAll('img');
      const extraBlocks = [];
      for (const img of extraImagesNodes) {
        if (img.width > 50 && !blocks.some(b => b.src === img.src)) {
          const base64 = await getBase64FromUrl(img.src);
          extraBlocks.push({ type: 'image', src: img.src, base64: base64 });
        }
      }

      // Merge
      if (role === 'user') {
        for (let i = extraBlocks.length - 1; i >= 0; i--) blocks.unshift(extraBlocks[i]);
      } else {
        extraBlocks.forEach(b => blocks.push(b));
      }

      for (const block of blocks) {
        if (block.type === 'image' && !block.base64) block.base64 = await getBase64FromUrl(block.src);
      }
      messages.push({ role, blocks });
    }
  }
  return { title: document.title, messages };
}

async function extractConversation() {
  let data;
  if (window.location.hostname.includes('gemini')) {
    data = await extractGeminiContent();
  } else if (window.location.hostname.includes('claude')) {
    const elements = document.querySelectorAll('.font-user-message, .font-claude-message');
    const msgs = [];
    for (const el of elements) {
      const role = el.classList.contains('font-user-message') ? 'user' : 'assistant';
      const blocks = parseDomToBlocks(el);
      if (blocks.length) msgs.push({ role, blocks });
    }
    data = { title: document.title, messages: msgs };
  } else {
    data = await extractChatGPTContent();
  }
  data.date = new Date().toLocaleString();
  return data;
}

// --- 4. RENDERER ---
async function generatePDF(data) {
  const { jsPDF } = window.jspdf || window;
  if (!jsPDF) { alert("jsPDF library not loaded."); return; }
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = 595.28; const pageHeight = 841.89; const margin = 36;
  let y = margin;
  const COLORS = { userBg: [243, 244, 246], aiBg: [255, 255, 255], border: [229, 231, 235], text: [31, 41, 55], codeBg: [40, 44, 52], codeText: [220, 220, 220] };

  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16);
  pdf.text((data.title || 'Export').substring(0, 50), margin, y); y += 54;

  for (const msg of data.messages) {
    if (!msg.blocks || msg.blocks.length === 0) continue;
    const isUser = msg.role === 'user';
    const bubbleWidth = 460;
    const x = isUser ? (pageWidth - margin - bubbleWidth) : margin;
    const padding = 20; const contentWidth = bubbleWidth - (padding * 2.5);
    let bubbleStartY = y; let pageItems = [];

    const flushPage = () => {
      if (pageItems.length === 0) return;
      const bubbleH = y - bubbleStartY + (padding / 2);
      pdf.setFillColor(...(isUser ? COLORS.userBg : COLORS.aiBg)); pdf.setDrawColor(...COLORS.border);
      pdf.roundedRect(x, bubbleStartY, bubbleWidth, bubbleH, 8, 8, 'FD');
      let codeGroupStart = null; let codeGroupH = 0;
      const flushCodeGroup = () => { if (codeGroupStart !== null) { pdf.setFillColor(...COLORS.codeBg); pdf.rect(x + padding, codeGroupStart - 6, contentWidth, codeGroupH + 12, 'F'); codeGroupStart = null; codeGroupH = 0; } };

      pageItems.forEach(item => { if (item.type === 'code_line') { if (codeGroupStart === null) codeGroupStart = item.y; codeGroupH += item.h; } else flushCodeGroup(); });
      flushCodeGroup();
      pageItems.forEach(item => {
        if (['text', 'bullet', 'header'].includes(item.type)) {
          pdf.setTextColor(...COLORS.text); pdf.setFont('helvetica', item.style || 'normal'); pdf.setFontSize(item.size || 10);
          pdf.text(item.content, x + padding + (item.indent || 0), item.y);
        } else if (item.type === 'code_line') {
          pdf.setTextColor(...COLORS.codeText); pdf.setFont('courier', 'normal'); pdf.setFontSize(9);
          pdf.text(item.content, x + padding + 10, item.y);
        } else if (item.type === 'image') {
          if (item.base64) pdf.addImage(item.base64, 'JPEG', x + padding, item.y, 250, 180);
          else { pdf.setTextColor(255, 0, 0); pdf.setFontSize(8); pdf.text('[Image Error]', x + padding, item.y + 20); }
        }
      });
      pageItems = [];
    };

    y += padding;
    for (const block of msg.blocks) {
      if (block.type === 'text') {
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10);
        const lines = pdf.splitTextToSize(block.content, contentWidth);
        for (const line of lines) { if (y + 14 > pageHeight - margin) { flushPage(); pdf.addPage(); y = margin + padding; bubbleStartY = margin; } pageItems.push({ type: 'text', content: line, y: y, size: 10 }); y += 14; }
      } else if (block.type === 'image') {
        if (y + 200 > pageHeight - margin) { flushPage(); pdf.addPage(); y = margin + padding; bubbleStartY = margin; }
        pageItems.push({ type: 'image', base64: block.base64, y: y }); y += 200;
      } else if (block.type === 'code') { /* simplified code block flow */
        pdf.setFont('courier', 'normal'); pdf.setFontSize(9);
        const lines = pdf.splitTextToSize(block.content, contentWidth - 20); y += 10;
        for (const line of lines) { if (y + 12 > pageHeight - margin) { flushPage(); pdf.addPage(); y = margin + padding; bubbleStartY = margin; y += 10; } pageItems.push({ type: 'code_line', content: line, y: y, h: 12 }); y += 12; } y += 10;
      } else if (block.type === 'break') y += 10;
    }
    y += padding; flushPage(); y += 15;
  }
  pdf.save('Smart_Fixed_Chat.pdf');
}

// "Brute Force" Interval Injection
function createFloatingMenu() {
  if (!document.body) return;
  const existing = document.getElementById('chat-exporter-menu');
  if (existing) return;
  const container = document.createElement('div');
  container.id = 'chat-exporter-menu';
  Object.assign(container.style, { position: 'fixed', bottom: '24px', right: '24px', zIndex: '9999999', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' });
  const mainBtn = document.createElement('button');
  mainBtn.innerHTML = '📄 Export';
  Object.assign(mainBtn.style, { padding: '12px 20px', borderRadius: '12px', border: 'none', background: '#000', color: '#fff', cursor: 'pointer', fontWeight: 'bold' });
  mainBtn.onclick = async () => { mainBtn.innerText = 'Processing...'; try { await generatePDF(await extractConversation()); } catch (e) { console.error(e); alert('Error'); } mainBtn.innerHTML = '📄 Export'; };
  container.appendChild(mainBtn); document.body.appendChild(container); console.log('Button Injected');
}
setInterval(createFloatingMenu, 2000);
createFloatingMenu();
