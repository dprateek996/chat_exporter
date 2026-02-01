// ============================================
// CONTENT SCRIPT: v17.0 GOLDEN ENGINE (Block-Based Restoration)
// ============================================

console.log('ChatArchive: Golden Engine v17.0 (Restored Layouts)');

// --- 1. IMAGE CAPTURE (v22.10 WITH SCREEN CAPTURE FALLBACK) ---
async function captureImageElement(img) {
  if (!img || !img.complete || img.naturalWidth < 20) {
    console.log('Image capture: skipped (incomplete or too small)');
    return null;
  }
  if (img.src.includes('svg')) return null;

  const src = img.src;

  // First try direct canvas capture
  try {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1500 / img.naturalWidth);
    canvas.width = img.naturalWidth * scale;
    canvas.height = img.naturalHeight * scale;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // Check for tainted canvas
    try {
      ctx.getImageData(0, 0, 1, 1);
      const base64 = canvas.toDataURL('image/jpeg', 0.90);
      if (base64.length > 1000) {
        console.log('Image capture: direct success, size:', Math.round(base64.length / 1024) + 'KB');
        return base64;
      }
    } catch (taintError) {
      console.log('Image capture: CORS blocked, trying screen capture for', src.substring(0, 60));
    }
  } catch (e) {
    console.log('Image capture: canvas error', e.message);
  }

  // Fallback 1: Try background fetch
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'FETCH_IMAGE_BASE64',
      url: src
    });

    if (response && response.success && response.base64 && response.base64.length > 1000) {
      console.log('Image capture: background fetch success, size:', Math.round(response.base64.length / 1024) + 'KB');
      return response.base64;
    }
  } catch (e) {
    console.log('Image capture: background fetch error:', e.message);
  }

  // Fallback 2: Screen capture (capture visible tab and crop)
  try {
    console.log('Image capture: trying screen capture method');

    // Scroll image into view
    img.scrollIntoView({ block: 'center', behavior: 'instant' });
    await new Promise(r => setTimeout(r, 100)); // Wait for scroll

    // Get image position on screen
    const rect = img.getBoundingClientRect();

    // Request screen capture from background
    const response = await chrome.runtime.sendMessage({
      type: 'CAPTURE_IMAGE_REGION',
      rect: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    });

    if (response && response.success && response.dataUrl) {
      // Crop the captured screenshot to the image region
      const cropCanvas = document.createElement('canvas');
      const dpr = window.devicePixelRatio || 1;
      cropCanvas.width = response.rect.width * dpr;
      cropCanvas.height = response.rect.height * dpr;

      const cropCtx = cropCanvas.getContext('2d');
      const fullImg = new Image();

      const base64 = await new Promise((resolve) => {
        fullImg.onload = () => {
          cropCtx.drawImage(
            fullImg,
            response.rect.x * dpr, response.rect.y * dpr, // source x, y
            response.rect.width * dpr, response.rect.height * dpr, // source w, h
            0, 0, cropCanvas.width, cropCanvas.height // dest x, y, w, h
          );
          const cropped = cropCanvas.toDataURL('image/jpeg', 0.90);
          resolve(cropped);
        };
        fullImg.onerror = () => resolve(null);
        fullImg.src = response.dataUrl;
      });

      if (base64 && base64.length > 1000) {
        console.log('Image capture: screen capture success, size:', Math.round(base64.length / 1024) + 'KB');
        return base64;
      }
    }
  } catch (e) {
    console.log('Image capture: screen capture error:', e.message);
  }

  console.log('Image capture: all methods failed for', src.substring(0, 50));
  return 'CORS_BLOCKED';
}

// --- 2. TEXT SANITIZER ---
function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u2022\u25E6\u2043\u2219]/g, "•")
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
    .replace(/[\u{2700}-\u{27BF}]/gu, '')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '')
    .trim();
}

// --- 3. DOM PARSER (v22.9 ASYNC FOR BACKGROUND IMAGE FETCH) ---
async function parseDomToBlocks(root) {
  const blocks = [];
  const seenImgs = new Set();
  const pendingImages = []; // Collect images for async capture

  function traverse(node, indent = 0) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = cleanText(node.textContent);
      if (text.length > 0) {
        const isHeader = (text.endsWith(':') && text.length < 50) ||
          (text === text.toUpperCase() && text.length > 4 && text.length < 40);
        blocks.push({
          type: isHeader ? 'header' : 'text',
          content: text,
          indent: indent
        });
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    if (['SCRIPT', 'STYLE', 'SVG', 'BUTTON', 'NAV', 'FORM'].includes(node.tagName)) return;

    const tag = node.tagName.toLowerCase();

    // CODE BLOCK (Black Box Style)
    if (tag === 'pre') {
      const codeEl = node.querySelector('code') || node;
      let rawText = codeEl.innerText || codeEl.textContent || '';
      let codeText = rawText.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
      if (!codeText.trim()) codeText = "// [Empty Code Block]";
      blocks.push({ type: 'code', content: codeText });
      return;
    }

    // LIST
    if (tag === 'li') {
      const text = cleanText(node.innerText);
      const prefix = (node.innerText.trim().match(/^[•\-\d]/)) ? '' : '• ';
      if (text) blocks.push({ type: 'text', content: prefix + text, indent: 15 });
      return;
    }

    // IMAGE - Add as pending for async capture
    if (tag === 'img') {
      const src = node.src || '';
      let w = node.naturalWidth || parseInt(node.getAttribute('width')) || node.clientWidth || 0;
      let h = node.naturalHeight || parseInt(node.getAttribute('height')) || node.clientHeight || 100;

      if (w > 30 && !src.includes('svg') && !src.includes('avatar') && !src.includes('profile') && !src.includes('icon') && !src.includes('emoji')) {
        if (!seenImgs.has(src)) {
          seenImgs.add(src);
          console.log('Image found:', src.substring(0, 50), 'w:', w, 'h:', h);
          // Add placeholder and track for async capture
          const idx = blocks.length;
          blocks.push({ type: 'image_pending', imgNode: node, w: w, h: h, idx: idx });
          pendingImages.push({ imgNode: node, w: w, h: h, idx: idx });
        }
      }
      return;
    }

    // HEADER
    if (/^h[1-6]$/.test(tag)) {
      blocks.push({ type: 'header', content: cleanText(node.innerText) });
      return;
    }

    // TABLE
    if (tag === 'table') {
      let tStr = '';
      node.querySelectorAll('tr').forEach((tr, i) => {
        const cells = Array.from(tr.querySelectorAll('td,th')).map(c => cleanText(c.innerText));
        tStr += '| ' + cells.join(' | ') + ' |\n';
        if (i === 0) tStr += '| ' + cells.map(() => '---').join(' | ') + ' |\n';
      });
      blocks.push({ type: 'code', content: tStr });
      return;
    }

    for (const child of node.childNodes) traverse(child, indent);

    if (['p', 'div', 'br'].includes(tag)) {
      if (blocks.length > 0 && blocks[blocks.length - 1].type !== 'break') {
        blocks.push({ type: 'break' });
      }
    }
  }

  traverse(root);

  // Capture all pending images in parallel
  if (pendingImages.length > 0) {
    console.log('Capturing', pendingImages.length, 'images...');
    const capturePromises = pendingImages.map(async (img) => {
      const base64 = await captureImageElement(img.imgNode);
      return { idx: img.idx, base64, w: img.w, h: img.h };
    });

    const results = await Promise.all(capturePromises);

    // Patch results back into blocks
    for (const result of results) {
      if (result.base64 === 'CORS_BLOCKED') {
        blocks[result.idx] = { type: 'text', content: '[Image could not be captured - cross-origin restriction]', indent: 0 };
      } else if (result.base64 && result.base64.length > 100) {
        blocks[result.idx] = { type: 'image', base64: result.base64, w: result.w, h: result.h };
        console.log('Image captured at idx', result.idx);
      } else {
        blocks[result.idx] = { type: 'text', content: '[Image skipped]', indent: 0 };
      }
    }
  }

  // Filter out any remaining pending images that weren't processed
  return blocks.filter(b => b.type !== 'image_pending');
}

// --- 4. EXTRACTOR: CHATGPT (v12.0 GOLDEN LOGIC) ---
async function extractChatGPTContent() {
  const articles = document.querySelectorAll('article');
  const messages = [];

  for (const article of articles) {
    const isUser = article.querySelector('[data-message-author-role="user"]');
    const role = isUser ? 'user' : 'assistant';

    let contentNode = article.querySelector('.markdown');
    if (!contentNode) contentNode = article.querySelector('[data-message-author-role] > div') || article;

    const blocks = await parseDomToBlocks(contentNode);

    // USER IMAGE FIX (v22.9 ASYNC)
    if (role === 'user') {
      const userImages = article.querySelectorAll('img');
      const uniqueUploads = new Set();
      for (const img of userImages) {
        const w = img.naturalWidth || img.width || img.clientWidth || 0;
        const h = img.naturalHeight || img.height || img.clientHeight || 100;
        const src = img.src || '';

        if (w > 30 && !src.includes('svg') && !src.includes('avatar') && !src.includes('icon')) {
          if (uniqueUploads.has(src)) continue;
          uniqueUploads.add(src);

          console.log('ChatGPT user image found:', src.substring(0, 50), 'w:', w);
          const base64 = await captureImageElement(img);
          if (base64 === 'CORS_BLOCKED') {
            blocks.unshift({ type: 'text', content: '[User image - cross-origin restriction]', indent: 0 });
          } else if (base64 && base64.length > 100) {
            blocks.unshift({ type: 'image', base64: base64, w: w, h: h });
            console.log('ChatGPT user image captured');
          }
        }
      }
    }

    if (blocks.length > 0) messages.push({ role, blocks });
  }

  return { title: document.title, messages };
}

// --- 5. EXTRACTOR: GEMINI (v22.6 REAL DOM SELECTORS) ---
async function extractGeminiContent() {
  const messages = [];
  const seenIds = new Set();

  console.log('Gemini v22.6: Starting extraction with real selectors...');

  // REAL GEMINI SELECTORS (from browser DOM inspection):
  // - Main container: infinite-scroller.chat-history
  // - Turn container: .conversation-container
  // - User message: user-query, content in .query-text
  // - AI message: model-response, content in .markdown

  // Find all conversation turns
  const turns = document.querySelectorAll('.conversation-container');
  console.log('Gemini: Found', turns.length, 'conversation turns');

  if (turns.length === 0) {
    // Fallback: try other selectors
    const fallbackTurns = document.querySelectorAll('user-query, model-response');
    console.log('Gemini: Fallback found', fallbackTurns.length, 'message elements');

    for (const el of fallbackTurns) {
      const isUser = el.tagName.toLowerCase() === 'user-query';
      const role = isUser ? 'user' : 'assistant';
      const contentEl = isUser ? el.querySelector('.query-text') || el : el.querySelector('.markdown') || el;
      const blocks = await parseDomToBlocks(contentEl);
      if (blocks.length > 0) messages.push({ role, blocks });
    }
  } else {
    // Process each turn (contains both user and AI message)
    for (const turn of turns) {
      // Dedupe by turn ID
      const turnId = turn.id;
      if (turnId && seenIds.has(turnId)) continue;
      if (turnId) seenIds.add(turnId);

      // Extract USER message
      const userQuery = turn.querySelector('user-query');
      if (userQuery) {
        const queryText = userQuery.querySelector('.query-text') || userQuery;
        const userBlocks = await parseDomToBlocks(queryText);

        // v22.9: Also capture user-uploaded images (ASYNC CORS-SAFE)
        const userImages = userQuery.querySelectorAll('img');
        for (const img of userImages) {
          const w = img.naturalWidth || img.width || img.clientWidth || 0;
          const h = img.naturalHeight || img.height || img.clientHeight || 100;
          const src = img.src || '';
          if (w > 30 && !src.includes('svg') && !src.includes('avatar') && !src.includes('icon')) {
            console.log('Gemini user image found:', src.substring(0, 50));
            const base64 = await captureImageElement(img);
            if (base64 === 'CORS_BLOCKED') {
              userBlocks.unshift({ type: 'text', content: '[User image - cross-origin restriction]', indent: 0 });
            } else if (base64 && base64.length > 100) {
              userBlocks.unshift({ type: 'image', base64: base64, w: w, h: h });
              console.log('Gemini user image captured successfully');
            }
          }
        }

        if (userBlocks.length > 0) {
          messages.push({ role: 'user', blocks: userBlocks });
        }
      }

      // Extract AI message
      const modelResponse = turn.querySelector('model-response');
      if (modelResponse) {
        const markdown = modelResponse.querySelector('.markdown') || modelResponse;
        const aiBlocks = await parseDomToBlocks(markdown);

        // v22.10: Also explicitly capture AI response images (in case parseDomToBlocks missed them)
        const aiImages = modelResponse.querySelectorAll('img');
        const seenAiSrcs = new Set();
        for (const img of aiImages) {
          const w = img.naturalWidth || img.width || img.clientWidth || 0;
          const h = img.naturalHeight || img.height || img.clientHeight || 100;
          const src = img.src || '';

          // Skip if already in blocks or too small
          if (seenAiSrcs.has(src)) continue;
          if (w < 30 || src.includes('svg') || src.includes('avatar') || src.includes('icon') || src.includes('emoji')) continue;

          // Check if this image is already in aiBlocks
          const alreadyCaptured = aiBlocks.some(b => b.type === 'image' && b.base64);
          if (!alreadyCaptured) {
            seenAiSrcs.add(src);
            console.log('Gemini AI image found:', src.substring(0, 50));
            const base64 = await captureImageElement(img);
            if (base64 && base64 !== 'CORS_BLOCKED' && base64.length > 100) {
              aiBlocks.push({ type: 'image', base64: base64, w: w, h: h });
              console.log('Gemini AI image captured successfully');
            }
          }
        }

        if (aiBlocks.length > 0) {
          messages.push({ role: 'assistant', blocks: aiBlocks });
        }
      }
    }
  }

  console.log('Gemini: Final extracted messages:', messages.length);
  return { title: document.title, messages };
}


// --- 6. PDF GENERATOR (v12.0 GOLDEN LOGIC - LOCALLY RESTORED) ---
// This guarantees the output looks EXACTLY like the checkpoint, because it IS the checkpoint logic.

async function generatePDF(data) {
  const { jsPDF } = window.jspdf || window;
  if (!jsPDF) { alert("jsPDF library not loaded. Please reload."); return; }

  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 40;

  let y = margin;

  // GOLDEN COLORS (Preserved)
  const COLORS = {
    userBg: [240, 242, 245],
    aiBg: [255, 255, 255],
    border: [220, 220, 220],
    text: [30, 30, 30],
    header: [0, 0, 0],
    codeBg: [30, 30, 30], // Black code background
    codeText: [255, 255, 255] // White code text
  };

  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(18);
  pdf.text((data.title || 'Chat Export').substring(0, 50), margin, y); y += 35;

  for (const msg of data.messages) {
    if (!msg.blocks || msg.blocks.length === 0) continue;

    const isUser = msg.role === 'user';
    const bubbleWidth = 460;
    const x = isUser ? (pageWidth - margin - bubbleWidth) : margin;
    const padding = 16;
    const contentWidth = bubbleWidth - (padding * 2);

    let bubbleStartY = y;
    let pageItems = [];

    const flushPage = () => {
      if (pageItems.length === 0) return;
      const bubbleH = y - bubbleStartY + (padding / 2);

      pdf.setFillColor(...(isUser ? COLORS.userBg : COLORS.aiBg));
      pdf.setDrawColor(...COLORS.border);
      pdf.roundedRect(x, bubbleStartY, bubbleWidth, bubbleH, 6, 6, 'FD');

      // Draw Code BG (Black Box)
      pageItems.forEach(item => {
        if (item.type === 'bg') {
          pdf.setFillColor(...COLORS.codeBg);
          pdf.rect(x + padding, item.y, contentWidth, item.h, 'F');
        }
      });

      // Draw Content
      pageItems.forEach(item => {
        if (item.type === 'text' || item.type === 'header') {
          // White text for code, Dark for normal
          if (item.isCode) {
            pdf.setTextColor(255, 255, 255);
          } else {
            const c = item.type === 'header' ? COLORS.header : COLORS.text;
            pdf.setTextColor(c[0], c[1], c[2]);
          }
          pdf.setFont(item.font || 'helvetica', item.style || 'normal');
          pdf.setFontSize(item.size || 10);
          pdf.text(item.content, x + padding + (item.indent || 0), item.y);
        } else if (item.type === 'image' && item.base64) {
          try {
            let imgW = Math.min(contentWidth, 350);
            if (item.w < 350) imgW = item.w;
            let imgH = (item.h * imgW) / item.w;
            if (imgH > 400) { imgH = 400; imgW = (item.w * imgH) / item.h; }
            const xOffset = (contentWidth - imgW) / 2;
            pdf.addImage(item.base64, 'JPEG', x + padding + xOffset, item.y, imgW, imgH);
          } catch (e) { }
        }
      });
      pageItems = [];
    };

    y += padding;

    for (const block of msg.blocks) {
      if (y > pageHeight - margin - 50) {
        flushPage(); pdf.addPage(); y = margin + padding; bubbleStartY = margin;
      }

      if (block.type === 'text' || block.type === 'header') {
        const isHead = block.type === 'header';
        const size = isHead ? 11 : 10;
        const style = isHead ? 'bold' : 'normal';
        pdf.setFont('helvetica', style); pdf.setFontSize(size);
        const lines = pdf.splitTextToSize(block.content, contentWidth - (block.indent || 0));
        for (const line of lines) {
          if (y > pageHeight - margin - 20) {
            flushPage(); pdf.addPage(); y = margin + padding; bubbleStartY = margin;
          }
          pageItems.push({ type: 'text', content: line, y: y, indent: block.indent, size, style, isCode: false });
          y += (isHead ? 16 : 14);
        }
        if (isHead) y += 5;
      } else if (block.type === 'image') {
        let imgW = Math.min(contentWidth, 350);
        if (block.w < 350) imgW = block.w;
        let imgH = (block.h * imgW) / block.w;
        if (imgH > 400) imgH = 400;

        if (y + imgH > pageHeight - margin) {
          flushPage(); pdf.addPage(); y = margin + padding; bubbleStartY = margin;
        }
        pageItems.push({ type: 'image', base64: block.base64, y: y, w: block.w, h: block.h });
        y += imgH + 15;
      } else if (block.type === 'code') {
        pdf.setFont('courier', 'normal'); pdf.setFontSize(9);
        const lines = pdf.splitTextToSize(block.content, contentWidth - 14);

        // v22.7: Split long code blocks across pages properly
        let codeStartY = y;
        let linesOnThisPage = [];

        y += 8; // Top padding
        for (let i = 0; i < lines.length; i++) {
          // Check if we need a new page
          if (y + 11 > pageHeight - margin - 20) {
            // Draw background for lines on this page
            if (linesOnThisPage.length > 0) {
              const bgH = (linesOnThisPage.length * 11) + 16;
              pageItems.push({ type: 'bg', y: codeStartY - 5, h: bgH });
              linesOnThisPage.forEach(item => pageItems.push(item));
            }
            flushPage();
            pdf.addPage();
            y = margin + padding + 8;
            bubbleStartY = margin;
            codeStartY = y - 8;
            linesOnThisPage = [];
          }
          linesOnThisPage.push({
            type: 'text', content: lines[i], y: y, style: 'normal', size: 9, font: 'courier', isCode: true
          });
          y += 11;
        }

        // Draw remaining lines background
        if (linesOnThisPage.length > 0) {
          const bgH = (linesOnThisPage.length * 11) + 16;
          pageItems.push({ type: 'bg', y: codeStartY - 5, h: bgH });
          linesOnThisPage.forEach(item => pageItems.push(item));
        }
        y += 12;
      } else if (block.type === 'break') y += 8;
    }

    y += padding;
    flushPage();
    y += 20;
  }

  const fn = (data.title || 'Chat').replace(/[^a-z0-9]/gi, '_').substring(0, 20);
  pdf.save(`ChatExport_${fn}.pdf`);
}


// --- 7. UI BRIDGE ---

async function runExport() {
  const host = window.location.hostname;
  let data;

  if (host.includes('chatgpt')) {
    data = await extractChatGPTContent();
  } else if (host.includes('gemini') || host.includes('google')) {
    data = await extractGeminiContent();
  } else {
    data = await extractChatGPTContent();
  }

  // Generate Locally (Exact Same as Checkpoint)
  await generatePDF(data);
}

function injectButton() {
  if (document.getElementById('chat-exporter-btn')) return;
  const btn = document.createElement('button');
  btn.id = 'chat-exporter-btn';
  btn.innerText = '📄 Export Chat';
  Object.assign(btn.style, {
    position: 'fixed', bottom: '20px', right: '20px', zIndex: 10000,
    padding: '12px 24px', background: '#10a37f', color: '#fff',
    border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold'
  });

  btn.onclick = async () => {
    const oldText = btn.innerText;
    btn.innerText = 'Processing...';
    try {
      await runExport();
      btn.innerText = '✅ Exported';
    } catch (e) {
      console.error(e);
      alert('Export failed: ' + e.message);
    } finally {
      setTimeout(() => btn.innerText = oldText, 3000);
    }
  };
  document.body.appendChild(btn);
}
setInterval(injectButton, 2000);
injectButton();
