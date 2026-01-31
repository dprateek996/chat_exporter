// ============================================
// CONTENT SCRIPT: FINAL FLOW-BASED RENDERER
// ============================================

// --- 1. UTILITIES & IMAGE FETCHING ---

async function getBase64FromUrl(url) {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    return null;
  }
}

function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/\[\s*\d+(?::\d+)?\s*\]/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

// --- 2. DOM PARSER ---

function parseDomToBlocks(root) {
  const blocks = [];
  function traverse(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = cleanText(node.textContent);
      if (text) blocks.push({ type: 'text', content: text });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName.toLowerCase();

    if (tag === 'pre') {
      const codeEl = node.querySelector('code') || node;
      const lang = (codeEl.className || '').replace('language-', '').toUpperCase() || 'CODE';
      blocks.push({ type: 'code', lang: lang, content: codeEl.innerText });
      return;
    }
    if (tag === 'img') {
      if (node.width > 40 && !node.src.includes('data:image/svg')) {
        blocks.push({ type: 'image', src: node.src });
      }
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
    if (tag === 'li') {
      blocks.push({ type: 'bullet', content: cleanText(node.innerText) });
      return;
    }
    for (const child of node.childNodes) traverse(child);
    if (tag === 'p' || tag === 'div' || tag === 'br') blocks.push({ type: 'break' });
  }
  traverse(root);
  return blocks;
}

// --- 3. EXTRACTORS ---

async function extractGeminiContent() {
  const turns = document.querySelectorAll('message-content, .message-content, [class*="conversation-turn"]');
  const messages = [];

  for (const turn of turns) {
    const isUser = turn.closest('.user-message') || turn.hasAttribute('data-is-user');
    const role = isUser ? 'user' : 'assistant';
    const blocks = parseDomToBlocks(turn);
    for (const block of blocks) {
      if (block.type === 'image') block.base64 = await getBase64FromUrl(block.src);
    }
    if (blocks.length > 0) messages.push({ role, blocks });
  }
  return { title: document.title.replace('Gemini', '').trim(), messages };
}

async function extractChatGPTContent() {
  const articles = document.querySelectorAll('article');
  const messages = [];

  for (const article of articles) {
    const isUser = article.querySelector('[data-message-author-role="user"]');
    const role = isUser ? 'user' : 'assistant';
    const contentNode = article.querySelector('.markdown') || article.querySelector('[data-message-author-role] + div');

    if (contentNode) {
      const blocks = parseDomToBlocks(contentNode);
      const extraImages = article.querySelectorAll('img[src^="blob:"], .grid img');
      for (const img of extraImages) {
        if (img.width > 100) {
          const base64 = await getBase64FromUrl(img.src);
          blocks.push({ type: 'image', src: img.src, base64: base64 });
        }
      }
      for (const block of blocks) {
        if (block.type === 'image') block.base64 = await getBase64FromUrl(block.src);
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
  data.stats = { total: data.messages.length };
  return data;
}

// --- 4. FLOW-BASED RENDERER (THE FIX) ---

async function generatePDF(data) {
  const { jsPDF } = window.jspdf || window;
  if (!jsPDF) { alert("jsPDF library not loaded."); return; }

  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 36;
  let y = margin;

  const COLORS = {
    userBg: [243, 244, 246], aiBg: [255, 255, 255],
    border: [229, 231, 235], text: [31, 41, 55],
    codeBg: [40, 44, 52], codeText: [220, 220, 220]
  };

  // --- Header ---
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.text((data.title || 'Export').substring(0, 50), margin, y);
  y += 24;
  pdf.setDrawColor(200);
  pdf.line(margin, y, pageWidth - margin, y);
  y += 30;

  // --- Message Loop ---
  for (const msg of data.messages) {
    if (!msg.blocks || msg.blocks.length === 0) continue;

    const isUser = msg.role === 'user';
    const bubbleWidth = 460;
    const x = isUser ? (pageWidth - margin - bubbleWidth) : margin;
    const padding = 20;
    const contentWidth = bubbleWidth - (padding * 2.5);

    // Context for the current message bubble
    let bubbleStartY = y;
    let pageItems = []; // buffer for items to draw on current page

    // 1. Flush Helper: Draws whatever is in `pageItems` to the PDF
    const flushPage = () => {
      if (pageItems.length === 0) return;

      const bubbleH = y - bubbleStartY + (padding / 2); // slightly pad bottom

      // A. Draw Bubble Background
      pdf.setFillColor(...(isUser ? COLORS.userBg : COLORS.aiBg));
      pdf.setDrawColor(...COLORS.border);
      pdf.roundedRect(x, bubbleStartY, bubbleWidth, bubbleH, 8, 8, 'FD');

      // B. Draw Groups (Code Backgrounds)
      let codeGroupStart = null;
      let codeGroupH = 0;

      const flushCodeGroup = () => {
        if (codeGroupStart !== null) {
          pdf.setFillColor(...COLORS.codeBg);
          // Draw slightly wider than text
          pdf.rect(x + padding, codeGroupStart - 6, contentWidth, codeGroupH + 12, 'F');
          codeGroupStart = null;
          codeGroupH = 0;
        }
      };

      // Scan for code items to draw backgrounds
      pageItems.forEach(item => {
        if (item.type === 'code_line') {
          if (codeGroupStart === null) codeGroupStart = item.y;
          codeGroupH += item.h;
        } else {
          flushCodeGroup();
        }
      });
      flushCodeGroup(); // Flush remaining

      // C. Draw Content
      pageItems.forEach(item => {
        if (item.type === 'text' || item.type === 'bullet' || item.type === 'header') {
          pdf.setTextColor(...COLORS.text);
          pdf.setFont('helvetica', item.style || 'normal');
          pdf.setFontSize(item.size || 10);
          pdf.text(item.content, x + padding + (item.indent || 0), item.y);
        }
        else if (item.type === 'code_line') {
          pdf.setTextColor(...COLORS.codeText);
          pdf.setFont('courier', 'normal');
          pdf.setFontSize(9);
          pdf.text(item.content, x + padding + 10, item.y);
          // Lang label logic could be added here if needed for first line
        }
        else if (item.type === 'image' && item.base64) {
          pdf.addImage(item.base64, 'JPEG', x + padding, item.y, 250, 180);
        }
      });

      pageItems = [];
    };

    // 2. Feed Content Stream
    // We add padding at start of bubble
    y += padding;

    // Process all blocks
    for (const block of msg.blocks) {

      // -- TEXT --
      if (block.type === 'text') {
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(10);
        const lines = pdf.splitTextToSize(block.content, contentWidth);
        const lineHeight = 14;

        for (const line of lines) {
          if (y + lineHeight > pageHeight - margin) {
            // Cutoff -> Flush -> New Page
            flushPage();
            pdf.addPage();
            y = margin + padding; // Top padding on new page
            bubbleStartY = margin;
          }
          pageItems.push({ type: 'text', content: line, y: y, size: 10 });
          y += lineHeight;
        }
      }

      // -- HEADER --
      else if (block.type === 'header') {
        const h = 20;
        if (y + h > pageHeight - margin) {
          flushPage(); pdf.addPage(); y = margin + padding; bubbleStartY = margin;
        }
        pageItems.push({ type: 'header', content: block.content, y: y, size: 12, style: 'bold' });
        y += h + 5;
      }

      // -- BULLET --
      else if (block.type === 'bullet') {
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(10);
        const lines = pdf.splitTextToSize(block.content, contentWidth - 15);
        const lineHeight = 14;

        // Draw bullet point on first line
        if (y + lineHeight > pageHeight - margin) {
          flushPage(); pdf.addPage(); y = margin + padding; bubbleStartY = margin;
        }
        pageItems.push({ type: 'text', content: '•', y: y, size: 10 });

        for (const line of lines) {
          if (y + lineHeight > pageHeight - margin) {
            flushPage(); pdf.addPage(); y = margin + padding; bubbleStartY = margin;
          }
          pageItems.push({ type: 'bullet', content: line, y: y, size: 10, indent: 15 });
          y += lineHeight;
        }
        y += 6;
      }

      // -- CODE -- 
      else if (block.type === 'code') {
        pdf.setFont('courier', 'normal');
        pdf.setFontSize(9);
        const lines = pdf.splitTextToSize(block.content, contentWidth - 20);
        const lineHeight = 12;

        // Gap before code
        y += 10;

        for (const line of lines) {
          if (y + lineHeight > pageHeight - margin) {
            flushPage();
            pdf.addPage();
            y = margin + padding;
            bubbleStartY = margin;

            // Gap on new page for code continued
            y += 10;
          }
          pageItems.push({ type: 'code_line', content: line, y: y, h: lineHeight });
          y += lineHeight;
        }
        y += 10; // Gap after code
      }

      // -- IMAGE --
      else if (block.type === 'image') {
        const imgH = 200;
        if (y + imgH > pageHeight - margin) {
          flushPage(); pdf.addPage(); y = margin + padding; bubbleStartY = margin;
        }
        if (block.base64) {
          pageItems.push({ type: 'image', base64: block.base64, y: y });
        } else {
          pageItems.push({ type: 'text', content: '[Image Error]', y: y, size: 8 });
        }
        y += imgH;
      }

      else if (block.type === 'break') {
        y += 10;
      }
    }

    // End of Message -> Flush remaining
    y += padding; // Bottom padding
    flushPage();
    y += 15; // Space between messages
  }

  pdf.save('Final_Fixed_Chat.pdf');
}

// --- 5. UI INJECTION ---

function createFloatingMenu() {
  const existing = document.getElementById('chat-exporter-menu');
  if (existing) return;

  const container = document.createElement('div');
  container.id = 'chat-exporter-menu';
  Object.assign(container.style, {
    position: 'fixed', bottom: '24px', right: '24px', zIndex: '999999',
    display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-end',
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif'
  });

  const menu = document.createElement('div');
  Object.assign(menu.style, {
    display: 'none', flexDirection: 'column', gap: '8px',
    background: '#2a2a2a', padding: '14px', borderRadius: '14px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)', border: '1px solid #3a3a3a'
  });

  const mainBtn = document.createElement('button');
  mainBtn.innerHTML = '<span style="margin-right:6px;">📄</span>Export';
  Object.assign(mainBtn.style, {
    padding: '11px 18px', borderRadius: '10px', border: '1px solid #3a3a3a',
    background: '#2a2a2a', color: '#e5e5e5', cursor: 'pointer', fontWeight: 'bold',
    display: 'flex', alignItems: 'center', boxShadow: '0 4px 16px rgba(0,0,0,0.3)'
  });

  mainBtn.onclick = () => {
    menu.style.display = menu.style.display === 'flex' ? 'none' : 'flex';
  };

  const createItem = (icon, label, action) => {
    const btn = document.createElement('button');
    btn.innerHTML = `<span style="margin-right:8px;">${icon}  </span>${label}`;
    Object.assign(btn.style, {
      padding: '10px 14px', borderRadius: '8px', border: 'none',
      background: '#333', color: '#fff', cursor: 'pointer', textAlign: 'left',
      width: '100%', display: 'flex', alignItems: 'center', marginBottom: '4px'
    });
    btn.onclick = async () => {
      mainBtn.innerText = '⏳';
      try {
        const data = await extractConversation();
        if (data.messages.length) await action(data);
        else alert('No messages found');
      } catch (e) { alert('Error: ' + e.message); console.error(e); }
      mainBtn.innerHTML = '<span style="margin-right:6px;">📄</span>Export';
      menu.style.display = 'none';
    };
    return btn;
  };

  menu.appendChild(createItem('📄', 'PDF', generatePDF));

  container.appendChild(menu);
  container.appendChild(mainBtn);
  document.body.appendChild(container);
}

new MutationObserver(() => {
  if (!document.getElementById('chat-exporter-menu')) createFloatingMenu();
}).observe(document.body, { childList: true, subtree: true });

createFloatingMenu();
