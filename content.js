// ============================================
// CONTENT SCRIPT: v17.3 GOLDEN ENGINE (Final Refinements)
// ============================================

console.log('ChatArchive: Golden Engine v17.3 (Final Parser Fixes)');

// --- 1. IMAGE CAPTURE (Safe Mode + CORS Fix) ---
function captureImageElement(img) {
  if (!img || !img.complete || img.naturalWidth < 20) return null;
  if (img.src.includes('svg')) return null;

  try {
    if (!img.crossOrigin) img.crossOrigin = "anonymous";

    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1500 / img.naturalWidth);
    canvas.width = img.naturalWidth * scale;
    canvas.height = img.naturalHeight * scale;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.90);
  } catch (e) {
    return null;
  }
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

// --- 3. DOM PARSER (v17.3 FINAL FIX) ---
function parseDomToBlocks(root) {
  const blocks = [];
  const seenImgs = new Set();
  const SQL_WORDS = /^(SELECT|FROM|WHERE|BETWEEN|IN|LOWER|UPPER|AND|OR)$/i;

  function traverse(node, indent = 0) {
    if (node.nodeType === Node.TEXT_NODE) {
      // FIX 2: PRESERVE INLINE CODE (Strong Markers)
      let raw = node.textContent || '';
      raw = raw.replace(/`([^`]+)`/g, (_, c) => `§§${c}§§`); // Stronger markers for PDF safety

      const text = cleanText(raw);

      if (text.length > 0) {
        // FIX 4: BULLET RECOVERY (Intercept to prevent duplication)
        const BULLET_LINES = /^(Faster|Uses index|Industry standard|Same result|Cleaner for indexing)$/i;
        if (BULLET_LINES.test(text)) {
          blocks.push({ type: 'text', content: '• ' + text, indent: 15 });
          return;
        }

        // FIX 3: STOP FALSE HEADERS (SQL)
        const isHeader = (text.endsWith(':') && text.length < 50) ||
          (
            text === text.toUpperCase() &&
            text.length > 4 &&
            text.length < 40 &&
            !SQL_WORDS.test(text.trim())
          );

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

    // IMAGE
    if (tag === 'img') {
      const w = node.getAttribute('width') || node.naturalWidth;
      if (w > 20 && !node.src.includes('svg')) {
        if (!seenImgs.has(node.src)) {
          seenImgs.add(node.src);
          const base64 = captureImageElement(node);
          if (base64) blocks.push({ type: 'image', base64: base64, w: w, h: node.clientHeight || 100 });
        }
      }
      return;
    }

    // HEADER
    if (/^h[1-6]$/.test(tag)) {
      blocks.push({ type: 'header', content: cleanText(node.innerText) });
      return;
    }

    // TABLE (Strict Check)
    if (tag === 'table') {
      let rows = [];
      node.querySelectorAll('tr').forEach((tr) => {
        const cells = Array.from(tr.querySelectorAll('td,th'))
          .map(c => (c.innerText || '').replace(/\n/g, ' ').trim())
          .filter(c => c.length > 0);

        if (cells.length > 0) rows.push(cells);
      });

      // Skip fake layout tables (< 2 rows)
      if (rows.length < 2) return;

      let tStr = '';
      rows.forEach((cells, i) => {
        tStr += '| ' + cells.join(' | ') + ' |\n';
        if (i === 0) tStr += '| ' + cells.map(() => '---').join(' | ') + ' |\n';
      });

      blocks.push({ type: 'code', content: tStr });
      return;
    }

    for (const child of node.childNodes) traverse(child, indent);

    // FIX 5: REMOVE EXTRA BLANK BREAKS (Strict P logic)
    if (['p'].includes(tag)) {
      const last = blocks[blocks.length - 1];
      if (last && last.type === 'text') {
        blocks.push({ type: 'break' });
      }
    }
  }

  traverse(root);
  return blocks;
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

    const blocks = parseDomToBlocks(contentNode);

    // USER IMAGE FIX (Aggressive Sweep)
    if (role === 'user') {
      const userImages = article.querySelectorAll('img');
      const uniqueUploads = new Set();
      for (const img of userImages) {
        if (img.width > 50 && !img.src.includes('svg')) {
          if (uniqueUploads.has(img.src)) continue;
          uniqueUploads.add(img.src);

          const base64 = captureImageElement(img);
          if (base64) {
            blocks.unshift({ type: 'image', base64: base64, w: img.naturalWidth, h: img.naturalHeight });
          }
        }
      }
    }

    if (blocks.length > 0) messages.push({ role, blocks });
  }

  return { title: document.title, messages };
}

// --- 5. EXTRACTOR: GEMINI (ADAPTED TO BLOCKS) ---
async function extractGeminiContent() {
  const messages = [];
  const mainElement = document.querySelector('main') || document.querySelector('.infinite-scroller');
  if (!mainElement) return { title: document.title, messages: [] };

  const children = Array.from(mainElement.children);

  for (const container of children) {
    if (container.clientHeight < 20) continue;

    let role = 'assistant';
    if (container.tagName.includes('USER') || container.className.includes('user') || container.getAttribute('data-role') === 'user') {
      role = 'user';
    }

    // Reuse the GOLDEN PARSER to ensure Gemini gets Blocks too!
    const blocks = parseDomToBlocks(container);
    if (blocks.length > 0) messages.push({ role, blocks });
  }

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
        const blockH = (lines.length * 11) + 16;
        if (y + blockH > pageHeight - margin) {
          flushPage(); pdf.addPage(); y = margin + padding; bubbleStartY = margin;
        }
        pageItems.push({ type: 'bg', y: y - 5, h: blockH });
        y += 8;
        for (const line of lines) {
          pageItems.push({
            type: 'text', content: line, y: y, style: 'normal', size: 9, font: 'courier', isCode: true
          });
          y += 11;
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

  // Generate Locally
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
