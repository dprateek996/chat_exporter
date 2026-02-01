// ============================================
// CONTENT SCRIPT: CHATGPT PRIORITY FIX
// ============================================

console.log('ChatArchive: ChatGPT Focus Engine v5.0');

// --- 1. IMAGE CAPTURE (Canvas Method) ---

function captureImageElement(img) {
  if (!img || !img.complete || img.naturalWidth === 0) return null;
  try {
    const canvas = document.createElement('canvas');
    // Scale down huge images to prevent PDF bloat/crashing
    const scale = Math.min(1, 1500 / img.naturalWidth);
    canvas.width = img.naturalWidth * scale;
    canvas.height = img.naturalHeight * scale;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch (e) {
    console.warn("Image capture failed:", e);
    return null;
  }
}

// --- 2. TEXT CLEANING (Fixes "Ø=ÜI" Symbols) ---

function cleanText(text) {
  if (!text) return '';
  return text
    // 1. Remove Emojis (jsPDF standard fonts cannot render them, causes garbage)
    .replace(/[\u{1F600}-\u{1F6FF}]/gu, '')
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '')
    // 2. Fix "Smart Quotes" and other special chars that turn into symbols
    .replace(/[\u2018\u2019]/g, "'") // Smart single quotes
    .replace(/[\u201C\u201D]/g, '"') // Smart double quotes
    .replace(/[\u2013\u2014]/g, '-') // Em-dashes
    .replace(/…/g, '...')
    // 3. Remove non-printable control characters
    .replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '')
    .trim();
}

// --- 3. DOM PARSER (Generic) ---

function parseDomToBlocks(root) {
  const blocks = [];
  const seenImgs = new Set();

  function traverse(node, indent = 0) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = cleanText(node.textContent);
      if (text.length > 0) blocks.push({ type: 'text', content: text, indent: indent });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    if (['SCRIPT', 'STYLE', 'SVG', 'BUTTON', 'NAV'].includes(node.tagName)) return;

    const tag = node.tagName.toLowerCase();

    // Code
    if (tag === 'pre') {
      const codeEl = node.querySelector('code') || node;
      blocks.push({ type: 'code', content: codeEl.innerText }); // Don't clean code formatting
      return;
    }

    // Lists
    if (tag === 'li') {
      const text = cleanText(node.innerText);
      const prefix = (node.innerText.trim().match(/^[•\-\d]/)) ? '' : '• ';
      if (text) blocks.push({ type: 'text', content: prefix + text, indent: 15 });
      return;
    }

    // Images (Standard)
    if (tag === 'img') {
      const width = node.getAttribute('width') || node.clientWidth || node.naturalWidth;
      if (width > 50 && !node.src.includes('svg')) {
        if (!seenImgs.has(node.src)) {
          seenImgs.add(node.src);
          const base64 = captureImageElement(node);
          if (base64) {
            blocks.push({ type: 'image', base64: base64, w: width, h: node.clientHeight || 100 });
          }
        }
      }
      return;
    }

    // Headers
    if (/^h[1-6]$/.test(tag)) {
      blocks.push({ type: 'header', content: cleanText(node.innerText).toUpperCase() });
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
  return blocks;
}

// --- 4. CHATGPT EXTRACTOR (SPECIFIC FIX) ---

async function extractChatGPTContent() {
  const articles = document.querySelectorAll('article');
  const messages = [];

  for (const article of articles) {
    // 1. Identify Role
    const isUser = article.querySelector('[data-message-author-role="user"]');
    const role = isUser ? 'user' : 'assistant';

    // 2. Find Text Content
    // AI usually has '.markdown', User usually has 'div' or specific whitespace
    let contentNode = article.querySelector('.markdown');
    if (!contentNode) {
      // Fallback for user messages
      const specificUserMsg = article.querySelector('[data-message-author-role] > div');
      contentNode = specificUserMsg || article;
    }

    const blocks = parseDomToBlocks(contentNode);

    // 3. IMAGE FIX: Scan for User Uploads (Blobs/Attachments)
    // ChatGPT puts user images often outside the .markdown block or in specific wrappers
    if (role === 'user') {
      const userImages = article.querySelectorAll('img');
      for (const img of userImages) {
        // We only want 'blob:' images (uploads) or standard images that weren't caught
        if (img.width > 50 && !img.src.includes('svg')) {
          // Check if we already grabbed this image in parseDomToBlocks
          const alreadyExists = blocks.some(b => b.type === 'image' && (b.base64?.length > 100)); // weak check but okay

          if (!alreadyExists) {
            const base64 = captureImageElement(img);
            if (base64) {
              // Add to START of message (User images usually come before text)
              blocks.unshift({ type: 'image', base64: base64, w: img.naturalWidth, h: img.naturalHeight });
            }
          }
        }
      }
    }

    if (blocks.length > 0) {
      messages.push({ role, blocks });
    }
  }

  return { title: document.title, messages };
}


// --- 5. PDF GENERATOR (Preserved Layout) ---

async function generatePDF(data) {
  const { jsPDF } = window.jspdf || window;
  if (!jsPDF) { alert("jsPDF library not loaded."); return; }

  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 40;

  let y = margin;
  const COLORS = {
    userBg: [243, 244, 246],
    aiBg: [255, 255, 255],
    border: [229, 231, 235],
    text: [31, 41, 55],
    codeBg: [40, 44, 52],
    codeText: [220, 220, 220]
  };

  // Header
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(18);
  pdf.text((data.title || 'Export').substring(0, 45), margin, y); y += 30;
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10);
  pdf.setTextColor(100); pdf.text(new Date().toLocaleString(), margin, y); y += 30;

  for (const msg of data.messages) {
    if (!msg.blocks || msg.blocks.length === 0) continue;

    const isUser = msg.role === 'user';
    const bubbleWidth = 440;
    const x = isUser ? (pageWidth - margin - bubbleWidth) : margin;
    const padding = 15;
    const contentWidth = bubbleWidth - (padding * 2);

    let bubbleStartY = y;
    let pageItems = [];

    const flushPage = () => {
      if (pageItems.length === 0) return;
      const bubbleH = y - bubbleStartY + (padding / 2);

      pdf.setFillColor(...(isUser ? COLORS.userBg : COLORS.aiBg));
      pdf.setDrawColor(...COLORS.border);
      pdf.roundedRect(x, bubbleStartY, bubbleWidth, bubbleH, 6, 6, 'FD');

      // Draw Code BG
      pageItems.forEach(item => {
        if (item.type === 'bg') {
          pdf.setFillColor(...COLORS.codeBg);
          pdf.rect(x + padding, item.y, contentWidth, item.h, 'F');
        }
      });

      // Draw Content
      pageItems.forEach(item => {
        if (item.type === 'text' || item.type === 'header') {
          pdf.setTextColor(...COLORS.text);
          pdf.setFont('helvetica', item.style || 'normal');
          pdf.setFontSize(item.size || 10);
          pdf.text(item.content, x + padding + (item.indent || 0), item.y);
        } else if (item.type === 'image' && item.base64) {
          try {
            // Ensure image fits
            const imgW = Math.min(contentWidth, 300);
            const imgH = (item.h * imgW) / item.w;
            pdf.addImage(item.base64, 'JPEG', x + padding, item.y, imgW, imgH);
          } catch (e) { }
        }
      });
      pageItems = [];
    };

    y += padding;

    for (const block of msg.blocks) {
      // Page Break Check
      if (y > pageHeight - margin - 50) {
        flushPage(); pdf.addPage(); y = margin + padding; bubbleStartY = margin;
      }

      if (block.type === 'text' || block.type === 'header') {
        const size = block.type === 'header' ? 12 : 10;
        const style = block.type === 'header' ? 'bold' : 'normal';
        pdf.setFont('helvetica', style); pdf.setFontSize(size);
        const lines = pdf.splitTextToSize(block.content, contentWidth - (block.indent || 0));
        for (const line of lines) {
          if (y > pageHeight - margin - 20) {
            flushPage(); pdf.addPage(); y = margin + padding; bubbleStartY = margin;
          }
          pageItems.push({ type: 'text', content: line, y: y, indent: block.indent, size, style });
          y += 14;
        }
      } else if (block.type === 'image') {
        const dispW = Math.min(contentWidth, 300);
        const dispH = (block.h * dispW) / block.w;

        if (y + dispH > pageHeight - margin) {
          flushPage(); pdf.addPage(); y = margin + padding; bubbleStartY = margin;
        }
        pageItems.push({ type: 'image', base64: block.base64, y: y, w: block.w, h: block.h });
        y += dispH + 10;
      } else if (block.type === 'code') {
        pdf.setFont('courier', 'normal'); pdf.setFontSize(9);
        const lines = pdf.splitTextToSize(block.content, contentWidth - 10);
        const blockH = (lines.length * 12) + 10;
        if (y + blockH > pageHeight - margin) {
          flushPage(); pdf.addPage(); y = margin + padding; bubbleStartY = margin;
        }
        pageItems.push({ type: 'bg', y: y - 5, h: blockH });
        for (const line of lines) {
          pageItems.push({ type: 'text', content: line, y: y, style: 'normal', size: 9 });
          y += 12;
        }
        y += 10;
      } else if (block.type === 'break') y += 8;
    }

    y += padding;
    flushPage();
    y += 20;
  }

  pdf.save('ChatExport.pdf');
}


// --- 6. ROUTER & UI ---

async function extractConversation() {
  // Currently focusing on ChatGPT as requested
  if (window.location.hostname.includes('chatgpt')) return await extractChatGPTContent();
  // Keep fallback for others or add later
  return await extractChatGPTContent();
}

function createFloatingMenu() {
  if (document.getElementById('chat-exporter-btn')) return;
  const btn = document.createElement('button');
  btn.id = 'chat-exporter-btn';
  btn.innerText = '📄 Export Chat';
  Object.assign(btn.style, {
    position: 'fixed', bottom: '20px', right: '20px', zIndex: 10000,
    padding: '12px 24px', background: '#10a37f', color: '#fff',
    border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold',
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
  });
  btn.onclick = async () => {
    const oldText = btn.innerText;
    btn.innerText = 'Processing...';
    try {
      const data = await extractConversation();
      await generatePDF(data);
      btn.innerText = '✅ Exported';
    } catch (e) {
      console.error(e);
      btn.innerText = '❌ Failed';
      alert('Export failed.');
    }
    setTimeout(() => btn.innerText = '📄 Export Chat', 3000);
  };
  document.body.appendChild(btn);
}
setInterval(createFloatingMenu, 2000);
createFloatingMenu();
