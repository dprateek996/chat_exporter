

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'exportConversation') {
    try {
      handleExport()
        .then(() => {
          sendResponse({ success: true });
        })
        .catch((err) => {
          console.error('ChatArchive Export Error:', err);
          sendResponse({ success: false, error: err.message || 'Export failed' });
        });
    } catch (e) {
      console.error('ChatArchive Synchronous Error:', e);
      sendResponse({ success: false, error: e.message });
    }
    return true; 
  }
});

async function handleExport() {
  const host = window.location.hostname;
  let data;

  if (host.includes('chatgpt') || host.includes('openai')) {
    data = await extractChatGPTContent();
  } else if (host.includes('gemini')) {
    data = await extractGeminiContent();
  } else if (host.includes('claude')) {
    data = await extractClaudeContent();
  } else if (host.includes('perplexity')) {
    data = await extractPerplexityContent();
  } else if (host.includes('grok')) {
    data = await extractGrokContent();
  } else {
    throw new Error('Unsupported platform');
  }

  if (data && data.messages && data.messages.length > 0) {
    await generatePDF(data);
  } else {
    throw new Error('No messages found');
  }
}


async function captureImageElement(img) {
  if (!img || !img.complete || img.naturalWidth < 20) {
    return null;
  }
  if (img.src.includes('svg')) return null;

  const src = img.src;


  try {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1500 / img.naturalWidth);
    canvas.width = img.naturalWidth * scale;
    canvas.height = img.naturalHeight * scale;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);


    try {
      ctx.getImageData(0, 0, 1, 1);
      const base64 = canvas.toDataURL('image/jpeg', 0.90);
      if (base64.length > 1000) {
        return base64;
      }
    } catch (taintError) {
    }
  } catch (e) {
  }


  try {
    const response = await chrome.runtime.sendMessage({
      type: 'FETCH_IMAGE_BASE64',
      url: src
    });

    if (response && response.success && response.base64 && response.base64.length > 1000) {
      return response.base64;
    }
  } catch (e) {
  }


  try {


    img.scrollIntoView({ block: 'center', behavior: 'instant' });
    await new Promise(r => setTimeout(r, 100));


    const rect = img.getBoundingClientRect();


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
            response.rect.x * dpr, response.rect.y * dpr,
            response.rect.width * dpr, response.rect.height * dpr,
            0, 0, cropCanvas.width, cropCanvas.height
          );
          const cropped = cropCanvas.toDataURL('image/jpeg', 0.90);
          resolve(cropped);
        };
        fullImg.onerror = () => resolve(null);
        fullImg.src = response.dataUrl;
      });

      if (base64 && base64.length > 1000) {
        return base64;
      }
    }
  } catch (e) {
  }

  return 'CORS_BLOCKED';
}


function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u2022\u25E6\u2043\u2219]/g, "•")

    .replace(/[\u2705\u2714\u2611]/g, '[v]')
    .replace(/[\u274C\u2716]/g, '[x]')
    .replace(/\u20B9/g, 'Rs.')
    .replace(/\u20AC/g, 'EUR')
    .replace(/\u00A3/g, 'GBP')
    .replace(/\u00A5/g, 'JPY')
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
    .replace(/[\u{2700}-\u{27BF}]/gu, '')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '')
    .trim();
}


function cleanTextForTable(text) {
  if (!text) return '';
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")

    .replace(/[\u2705\u2714\u2611]/g, '[v]')
    .replace(/[\u274C\u2716]/g, '[x]')
    .replace(/\u20B9/g, 'Rs.')
    .replace(/\u20AC/g, 'EUR')
    .replace(/\u00A3/g, 'GBP')
    .replace(/\u00A5/g, 'JPY')
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
    .replace(/[\u{2700}-\u{27BF}]/gu, '')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '')
    .trim();
}


async function parseDomToBlocks(root, contextRole = 'assistant') { // Added contextRole
  const blocks = [];
  const seenImgs = new Set();
  const pendingImages = [];

  function traverse(node, indent = 0) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.parentElement) {
        const pClass = node.parentElement.className;
        if (typeof pClass === 'string' && (pClass.includes('sr-only') || pClass.includes('invisible') || pClass.includes('hidden'))) {
          return;
        }
      }

      const text = cleanText(node.textContent);
      if (text.length > 0) {
        let isHeader = (text.endsWith(':') && text.length < 50) ||
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

    if (node.classList && (node.classList.contains('sr-only') || node.classList.contains('invisible') || node.classList.contains('hidden'))) return;
    if (['SCRIPT', 'STYLE', 'SVG', 'BUTTON', 'NAV', 'FORM'].includes(node.tagName)) return;

    const tag = node.tagName.toLowerCase();

    if (tag === 'pre') {
      const codeEl = node.querySelector('code') || node;
      let rawText = codeEl.innerText || codeEl.textContent || '';
      let codeText = rawText.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
      if (!codeText.trim()) codeText = "// [Empty Code Block]";
      blocks.push({ type: 'code', content: codeText });
      return;
    }

    if (node.classList && (node.classList.contains('katex-display') || node.classList.contains('katex'))) {
      const annotation = node.querySelector('annotation');
      const tex = annotation ? annotation.textContent : node.textContent;
      const cleanTex = tex.replace(/\s+/g, ' ').trim();
      blocks.push({ type: 'code', content: cleanTex });
      return;
    }

    if (tag === 'li') {
      const text = cleanText(node.innerText);
      const prefix = (node.innerText.trim().match(/^[•\-\d]/)) ? '' : '• ';
      if (text) blocks.push({ type: 'text', content: prefix + text, indent: 15 });
      return;
    }

    if (tag === 'img') {
      const src = node.src || '';
      let w = node.naturalWidth || parseInt(node.getAttribute('width')) || node.clientWidth || 0;
      let h = node.naturalHeight || parseInt(node.getAttribute('height')) || node.clientHeight || 100;

      if (w > 30 && !src.includes('svg') && !src.includes('avatar') && !src.includes('profile') && !src.includes('icon') && !src.includes('emoji')) {
        if (!seenImgs.has(src)) {
          seenImgs.add(src);
          const idx = blocks.length;
          blocks.push({ type: 'image_pending', imgNode: node, w: w, h: h, idx: idx });
          pendingImages.push({ imgNode: node, w: w, h: h, idx: idx });
        }
      }
      return;
    }

    if (/^h[1-6]$/.test(tag)) {
      if (contextRole === 'user') {
        blocks.push({ type: 'text', content: cleanText(node.innerText) });
      } else {
        blocks.push({ type: 'header', content: cleanText(node.innerText) });
      }
      return;
    }

    if (tag === 'table') {
      let tStr = '';
      node.querySelectorAll('tr').forEach((tr, i) => {
        const cells = Array.from(tr.querySelectorAll('td,th')).map(c => {
          let raw = c.innerText || c.textContent || '';
          let cellText = raw.replace(/[\n\r\t]+/g, ' ').trim();
          return cleanTextForTable(cellText);
        });
        tStr += '| ' + cells.join(' | ') + ' |\n';
        if (i === 0) tStr += '| ' + cells.map(() => '---').join(' | ') + ' |\n';
      });
      blocks.push({ type: 'code', content: tStr });
      return;
    }

    if (tag === 'a') {
      const href = node.getAttribute('href') || '';
      const text = cleanText(node.innerText);
      if (text && href && !href.startsWith('#') && !href.startsWith('javascript:')) {
        blocks.push({ type: 'link', content: text, url: href });
        return;
      }
    }

    for (const child of node.childNodes) traverse(child, indent);

    if (['p', 'div', 'br'].includes(tag)) {
      if (blocks.length > 0 && blocks[blocks.length - 1].type !== 'break') {
        blocks.push({ type: 'break' });
      }
    }
  }

  traverse(root);

  if (pendingImages.length > 0) {
    const capturePromises = pendingImages.map(async (img) => {
      const base64 = await captureImageElement(img.imgNode);
      return { idx: img.idx, base64, w: img.w, h: img.h };
    });
    const results = await Promise.all(capturePromises);
    for (const result of results) {
      if (result.base64 === 'CORS_BLOCKED') {
        blocks[result.idx] = { type: 'text', content: '[Image could not be captured - cross-origin restriction]', indent: 0 };
      } else if (result.base64 && result.base64.length > 100) {
        blocks[result.idx] = { type: 'image', base64: result.base64, w: result.w, h: result.h };
      } else {
        blocks[result.idx] = { type: 'text', content: '[Image skipped]', indent: 0 };
      }
    }
  }

  return blocks.filter(b => b.type !== 'image_pending');
}


async function extractChatGPTContent() {
  const articles = document.querySelectorAll('article');
  const messages = [];

  for (const article of articles) {
    const isUser = article.querySelector('[data-message-author-role="user"]');
    const role = isUser ? 'user' : 'assistant';

    let contentNode = article.querySelector('.markdown');
    if (!contentNode) contentNode = article.querySelector('[data-message-author-role] > div') || article;

    const blocks = await parseDomToBlocks(contentNode, role);


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


          const base64 = await captureImageElement(img);
          if (base64 === 'CORS_BLOCKED') {
            blocks.unshift({ type: 'text', content: '[User image - cross-origin restriction]', indent: 0 });
          } else if (base64 && base64.length > 100) {
            blocks.unshift({ type: 'image', base64: base64, w: w, h: h });

          }
        }
      }
    }

    if (blocks.length > 0) messages.push({ role, blocks });
  }

  return { title: document.title, messages };
}


async function extractGeminiContent() {
  const messages = [];
  const seenIds = new Set();
  const turns = document.querySelectorAll('.conversation-container');

  if (turns.length === 0) {
    const fallbackTurns = document.querySelectorAll('user-query, model-response');
    for (const el of fallbackTurns) {
      const isUser = el.tagName.toLowerCase() === 'user-query';
      const role = isUser ? 'user' : 'assistant';
      const contentEl = isUser ? el.querySelector('.query-text') || el : el.querySelector('.markdown') || el;
      const blocks = await parseDomToBlocks(contentEl, role);
      if (blocks.length > 0) messages.push({ role, blocks });
    }
  } else {
    for (const turn of turns) {
      const turnId = turn.id;
      if (turnId && seenIds.has(turnId)) continue;
      if (turnId) seenIds.add(turnId);

      const userQuery = turn.querySelector('user-query');
      if (userQuery) {
        const queryText = userQuery.querySelector('.query-text') || userQuery;
        const userBlocks = await parseDomToBlocks(queryText, 'user');
        const userImages = userQuery.querySelectorAll('img');
        for (const img of userImages) {
          const w = img.naturalWidth || 0;
          if (w > 30 && !img.src.includes('svg')) {
            const base64 = await captureImageElement(img);
            if (base64 && base64.length > 100) userBlocks.unshift({ type: 'image', base64, w: w, h: 100 });
          }
        }
        if (userBlocks.length > 0) messages.push({ role: 'user', blocks: userBlocks });
      }

      const modelResponse = turn.querySelector('model-response');
      if (modelResponse) {
        const markdown = modelResponse.querySelector('.markdown') || modelResponse;
        const aiBlocks = await parseDomToBlocks(markdown, 'assistant');
        if (aiBlocks.length > 0) messages.push({ role: 'assistant', blocks: aiBlocks });
      }
    }
  }
  return { title: document.title, messages };
}

async function extractClaudeContent() {
  const messages = [];
  const userMessageElements = Array.from(document.querySelectorAll('[data-testid="user-message"]'));
  const assistantMessageElements = Array.from(document.querySelectorAll('.font-claude-response'));
  const allMessages = [];

  for (const el of userMessageElements) {
    const rect = el.getBoundingClientRect();
    allMessages.push({ role: 'user', element: el, top: rect.top + window.scrollY });
  }
  for (const el of assistantMessageElements) {
    const rect = el.getBoundingClientRect();
    allMessages.push({ role: 'assistant', element: el, top: rect.top + window.scrollY });
  }
  allMessages.sort((a, b) => a.top - b.top);

  for (const msg of allMessages) {
    const blocks = await parseDomToBlocks(msg.element, msg.role);
    if (blocks.length > 0) messages.push({ role: msg.role, blocks });
  }

  if (messages.length === 0) {
    const proseElements = Array.from(document.querySelectorAll('.prose'));
    for (let i = 0; i < proseElements.length; i++) {
      const role = i % 2 === 0 ? 'user' : 'assistant';
      const blocks = await parseDomToBlocks(proseElements[i], role);
      if (blocks.length > 0) messages.push({ role, blocks });
    }
  }

  return { title: document.title || 'Claude Conversation', messages };
}

async function extractPerplexityContent() {
  const messages = [];

  const proseElements = document.querySelectorAll('.prose');

  if (proseElements.length > 0) {
    for (const prose of proseElements) {
      let prev = prose.previousElementSibling;
      let userFound = false;

      while (prev) {
        if (prev.querySelector('h1') || prev.classList.contains('font-display') || prev.querySelector('.font-display')) {
          const userBlocks = await parseDomToBlocks(prev, 'user');
          if (userBlocks.length > 0) {
            messages.push({ role: 'user', blocks: userBlocks });
            userFound = true;
          }
          break;
        }
        if (prev.tagName === 'DIV' && prev.innerText.length > 500) break;
        prev = prev.previousElementSibling;
      }

      const aiBlocks = await parseDomToBlocks(prose, 'assistant');
      if (aiBlocks.length > 0) {
        messages.push({ role: 'assistant', blocks: aiBlocks });
      }
    }

    if (messages.length > 0 && messages[0].role !== 'user') {
      const titleH1 = document.querySelector('h1');
      if (titleH1 && !messages.some(m => m.blocks[0]?.content === titleH1.innerText.trim())) {
        const titleBlocks = await parseDomToBlocks(titleH1, 'user');
        if (titleBlocks.length > 0) messages.unshift({ role: 'user', blocks: titleBlocks });
      }
    }

  } else {
    const validContainer = document.querySelector('main div.col-start-2') || document.querySelector('main');
    if (validContainer) {
      for (const child of validContainer.children) {
        const text = child.innerText.trim();
        if (text.length < 200 && (text.includes('History') || text.includes('Discover') || text.includes('Spaces') || text.includes('Library'))) continue;

        if (child.querySelector('.prose')) {
          const blocks = await parseDomToBlocks(child.querySelector('.prose'), 'assistant');
          messages.push({ role: 'assistant', blocks });
        } else {
          const blocks = await parseDomToBlocks(child, 'user');
          if (blocks.length > 0) messages.push({ role: 'user', blocks });
        }
      }
    }
  }

  return { title: document.title, messages };
}

async function extractGrokContent() {
  const messages = [];

  const userContainers = Array.from(document.querySelectorAll('.items-end'));
  const aiContainers = Array.from(document.querySelectorAll('.items-start'));

  const allBubbles = [];

  for (const container of userContainers) {
    if (container.innerText.length < 2) continue;
    const rect = container.getBoundingClientRect();
    if (rect.height === 0) continue;
    allBubbles.push({ role: 'user', element: container, top: rect.top + window.scrollY });
  }

  for (const container of aiContainers) {
    if (container.innerText.length < 2 && !container.querySelector('img')) continue;
    const rect = container.getBoundingClientRect();

    const contentEl = container.querySelector('.prose') || container;
    allBubbles.push({ role: 'assistant', element: contentEl, top: rect.top + window.scrollY });
  }

  allBubbles.sort((a, b) => a.top - b.top);

  for (const item of allBubbles) {
    const blocks = await parseDomToBlocks(item.element, item.role);
    if (blocks.length > 0 && !blocks.every(b => b.content === '')) {
      const fullText = blocks.map(b => b.content).join(' ').trim();

      if (/^(Auto|Grok 2|Grok 2 mini|Standard|Fun|Model:.*)$/i.test(fullText)) {
        continue;
      }

      messages.push({ role: item.role, blocks });
    }
  }

  if (messages.length === 0) {
    const candidates = document.querySelectorAll('main div > div');
    for (const row of candidates) {
      if (row.innerText.length > 5) {
        const role = row.innerText.includes('Grok') ? 'assistant' : 'user'; // Weak heuristic
        const blocks = await parseDomToBlocks(row, role);
        if (blocks.length > 0) messages.push({ role, blocks });
      }
    }
  }

  return { title: document.title, messages };
}

async function generatePDF(data) {
  const { jsPDF } = window.jspdf || window;
  if (!jsPDF) { alert("jsPDF library not loaded. Please reload."); return; }

  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 40;

  let y = margin;

  const COLORS = {
    userBg: [240, 242, 245],
    aiBg: [255, 255, 255],
    border: [220, 220, 220],
    text: [30, 30, 30],
    header: [0, 0, 0],
    codeBg: [30, 30, 30],
    codeText: [255, 255, 255]
  };

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(22);
  pdf.setTextColor(20, 20, 20);
  const title = (data.title || 'Chat Archive').substring(0, 45);
  pdf.text(title, margin, y);
  y += 18;

  pdf.setFontSize(8);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(150, 150, 150);
  pdf.text('ARCHIVED VIA CHATARCHIVE PREMIUM', margin, y);
  y += 25;

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

      pageItems.forEach(item => {
        if (item.type === 'bg') {
          pdf.setFillColor(...COLORS.codeBg);
          pdf.rect(x + padding, item.y, contentWidth, item.h, 'F');
        }
      });

      
      pageItems.forEach(item => {
        if (item.type === 'text' || item.type === 'header') {
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
        } else if (item.type === 'link') {
          pdf.setTextColor(0, 102, 204);
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(10);
          pdf.text(item.content, x + padding, item.y);
          try {
            const textWidth = pdf.getTextWidth(item.content);
            pdf.link(x + padding, item.y - 10, textWidth, 12, { url: item.url });
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


        let codeStartY = y;
        let linesOnThisPage = [];

        y += 8;
        for (let i = 0; i < lines.length; i++) {

          if (y + 11 > pageHeight - margin - 20) {
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

        if (linesOnThisPage.length > 0) {
          const bgH = (linesOnThisPage.length * 11) + 16;
          pageItems.push({ type: 'bg', y: codeStartY - 5, h: bgH });
          linesOnThisPage.forEach(item => pageItems.push(item));
        }
        y += 12;
      } else if (block.type === 'link') {
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(10);
        const linkText = block.content + ' (' + block.url + ')';
        const lines = pdf.splitTextToSize(linkText, contentWidth);
        for (const line of lines) {
          if (y > pageHeight - margin - 20) {
            flushPage(); pdf.addPage(); y = margin + padding; bubbleStartY = margin;
          }
          pageItems.push({ type: 'link', content: line, y: y, url: block.url });
          y += 14;
        }
      } else if (block.type === 'break') y += 8;
    }

    y += padding;
    flushPage();
    y += 20;
  }

  const fn = (data.title || 'Chat').replace(/[^a-z0-9]/gi, '_').substring(0, 20);
  pdf.save(`ChatExport_${fn}.pdf`);
}

