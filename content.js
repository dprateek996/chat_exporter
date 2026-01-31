/**
 * AI Chat Exporter - Export conversations from ChatGPT & Gemini to PDF
 * Version: 2.0.0 - Production Ready
 */

// ============================================
// STATE & DETECTION
// ============================================

let jsPDFInstance = null;
let jsPDFLib = null;
const isGemini = location.hostname.includes('gemini.google.com');
const isChatGPT = location.hostname.includes('chatgpt.com') || location.hostname.includes('openai.com');
const isClaude = location.hostname.includes('claude.ai');

// UI patterns to filter out from extraction
const UI_PATTERNS = [
  /^gemini$/i, /^copy$/i, /^share$/i, /^edit$/i, /^listen$/i,
  /^tools$/i, /^recent$/i, /^gems$/i, /^help$/i, /^settings$/i,
  /^new chat$/i, /^pro$/i, /^show thinking/i, /^thinking/i,
  /^add files$/i, /^explore gems$/i, /^more options$/i,
  /^double-check/i, /^report/i, /^invite a friend/i,
  /gemini can make mistakes/i, /^\+$/, /^choose your model/i,
  /^claude$/i, /^retry$/i, /^continue$/i, /^projects$/i
];

// ============================================
// LIBRARY LOADING
// ============================================

(async () => {
  try {
    if (isGemini || isClaude) {
      console.log(`📚 Loading jsPDF for ${isClaude ? 'Claude' : 'Gemini'}...`);
      const jsPDFUrl = chrome.runtime.getURL('libs/jspdf.umd.min.js');
      await import(jsPDFUrl);
      
      if (window.jspdf?.jsPDF) {
        jsPDFLib = window.jspdf.jsPDF;
        jsPDFInstance = true;
        console.log('✅ jsPDF loaded successfully');
      }
      return;
    }
    
    // For ChatGPT - use script injection
    const jsPDFScript = document.createElement('script');
    jsPDFScript.src = chrome.runtime.getURL('libs/jspdf.umd.min.js');
    document.head.appendChild(jsPDFScript);
    
    jsPDFScript.onload = () => {
      const injectedScript = document.createElement('script');
      injectedScript.src = chrome.runtime.getURL('injected.js');
      document.head.appendChild(injectedScript);
    };
    
    window.addEventListener('message', (event) => {
      if (event.source === window && event.data.type === 'JSPDF_READY') {
        jsPDFInstance = true;
      }
    });
  } catch (error) {
    console.error('❌ Failed to load jsPDF:', error);
  }
})();

// ============================================
// UTILITY FUNCTIONS
// ============================================

const wait = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Request blob image conversion from injected script (page context)
 * This works because blob: URLs are context-specific
 */
async function fetchBlobImageViaInjected(blobUrl) {
  return new Promise((resolve) => {
    const requestId = 'blob_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    const handler = (event) => {
      if (event.source === window && 
          event.data.type === 'BLOB_IMAGE_RESULT' && 
          event.data.requestId === requestId) {
        window.removeEventListener('message', handler);
        resolve(event.data.base64);
      }
    };
    
    window.addEventListener('message', handler);
    window.postMessage({ type: 'FETCH_BLOB_IMAGE', blobUrl, requestId }, '*');
    
    // Timeout after 5 seconds
    setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve(null);
    }, 5000);
  });
}

/**
 * Clean text by removing garbage characters and fixing spacing
 * Also sanitizes for PDF output (jsPDF only supports basic Latin characters)
 */
function cleanText(text, forPDF = false) {
  if (!text) return '';
  
  let cleaned = text;
  
  // Remove zero-width and invisible characters
  cleaned = cleaned
    .replace(/[\u200B-\u200D\uFEFF\u00AD\u200E\u200F]/g, '')
    .replace(/[\u2028\u2029]/g, '\n'); // Line/paragraph separators
  
  // Remove private use area characters (icons/symbols from custom fonts)
  cleaned = cleaned.replace(/[\uE000-\uF8FF]/g, '');
  
  // Remove garbage/corrupted characters (icon fonts, symbol fonts)
  cleaned = cleaned
    // Pattern: Ø followed by symbols and letters (common icon font garbage)
    .replace(/Ø[=<>]?[A-Za-zÞþßÜÄŸ€Ý]*/g, '')
    // Individual garbage characters from icon/symbol fonts
    .replace(/[֍þãÜÀŸ¢ßØÞ€Ý]/g, '')
    // More icon font patterns
    .replace(/[\uF000-\uFFFF]/g, '') // Supplementary private use area
    .replace(/[\u2700-\u27BF]/g, match => {
      // Dingbats - convert some, remove others
      if (match === '\u2713' || match === '\u2714') return '[v]';
      if (match === '\u2717' || match === '\u2718') return '[x]';
      return '';
    });
  
  // Normalize common Unicode characters to ASCII equivalents
  const unicodeToAscii = {
    // Quotes
    '\u2018': "'", '\u2019': "'", '\u201A': "'", '\u201B': "'",
    '\u201C': '"', '\u201D': '"', '\u201E': '"', '\u201F': '"',
    '\u2039': '<', '\u203A': '>',
    '\u00AB': '"', '\u00BB': '"',
    // Dashes
    '\u2013': '-', '\u2014': '-', '\u2015': '-', '\u2212': '-',
    // Spaces
    '\u00A0': ' ', '\u2002': ' ', '\u2003': ' ', '\u2009': ' ',
    // Ellipsis
    '\u2026': '...',
    // Arrows (convert to text)
    '\u2192': '->', '\u2190': '<-', '\u2194': '<->',
    '\u21D2': '=>', '\u21D0': '<=',
    '\u27A4': '->', '\u2794': '->', '\u279C': '->',
    // Math symbols
    '\u00D7': 'x', '\u00F7': '/',
    '\u2260': '!=', '\u2264': '<=', '\u2265': '>=',
    '\u221E': 'infinity',
    // Check marks and crosses
    '\u2713': '[v]', '\u2714': '[v]', '\u2715': '[x]', '\u2716': '[x]',
    '\u2717': '[x]', '\u2718': '[x]',
    // Copyright, trademark
    '\u00A9': '(c)', '\u00AE': '(R)', '\u2122': '(TM)',
  };
  
  for (const [unicode, ascii] of Object.entries(unicodeToAscii)) {
    cleaned = cleaned.replace(new RegExp(unicode, 'g'), ascii);
  }
  
  // Normalize bullet points to standard ASCII bullet or dash
  const bulletChars = /[\u2022\u2023\u25E6\u2043\u2219\u25AA\u25CF\u25CB\u25B6\u25BA\u25C6\u25C7\u25D8\u25D9\u2605\u2606\u2666\u2756\u27A2\u29BF\u25A0\u25A1\u25AA\u25AB\u2B24\u26AB\u26AA●○◦◉◆◇▪▫★☆►▸◂◀]/g;
  cleaned = cleaned.replace(bulletChars, '-');
  
  if (forPDF) {
    // For PDF: Replace remaining non-ASCII with closest ASCII or remove
    cleaned = cleaned
      // Common accented characters to base letters
      .replace(/[àáâãäå]/gi, match => match.toLowerCase() === match ? 'a' : 'A')
      .replace(/[èéêë]/gi, match => match.toLowerCase() === match ? 'e' : 'E')
      .replace(/[ìíîï]/gi, match => match.toLowerCase() === match ? 'i' : 'I')
      .replace(/[òóôõö]/gi, match => match.toLowerCase() === match ? 'o' : 'O')
      .replace(/[ùúûü]/gi, match => match.toLowerCase() === match ? 'u' : 'U')
      .replace(/[ñ]/gi, match => match.toLowerCase() === match ? 'n' : 'N')
      .replace(/[ç]/gi, match => match.toLowerCase() === match ? 'c' : 'C')
      .replace(/[ß]/g, 'ss')
      .replace(/[æ]/gi, 'ae')
      .replace(/[œ]/gi, 'oe')
      // Remove any remaining non-printable or non-ASCII characters
      .replace(/[^\x20-\x7E\n\t]/g, '');
  }
  
  // Fix spaced-out text (like "H e l l o" -> "Hello")
  for (let i = 0; i < 3; i++) {
    cleaned = cleaned
      .replace(/\b([A-Za-z])\s([A-Za-z])\s([A-Za-z])\s([A-Za-z])\s([A-Za-z])\s([A-Za-z])\s([A-Za-z])\s([A-Za-z])\b/g, '$1$2$3$4$5$6$7$8')
      .replace(/\b([A-Za-z])\s([A-Za-z])\s([A-Za-z])\s([A-Za-z])\s([A-Za-z])\s([A-Za-z])\b/g, '$1$2$3$4$5$6')
      .replace(/\b([A-Za-z])\s([A-Za-z])\s([A-Za-z])\s([A-Za-z])\b/g, '$1$2$3$4');
  }
  
  // Clean up multiple spaces and trim
  return cleaned.replace(/  +/g, ' ').replace(/\n\s*\n\s*\n/g, '\n\n').trim();
}

/**
 * Check if line should be filtered (UI element)
 */
function shouldFilterLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length < 2) return true;
  if (UI_PATTERNS.some(p => p.test(trimmed))) return true;
  if (/^[+\-•]$/.test(trimmed)) return true;
  return false;
}

// ============================================
// GEMINI EXTRACTION
// ============================================

async function extractGeminiContent() {
  console.log('🔍 Extracting Gemini conversation...');
  
  // Scroll to load all content
  for (let i = 0; i < 20; i++) {
    window.scrollTo(0, document.body.scrollHeight);
    await wait(150);
  }
  window.scrollTo(0, 0);
  await wait(500);
  
  // Get title
  let title = document.title?.replace(' - Google', '').replace('Gemini', '').trim() || 'Gemini Conversation';
  
  const messages = [];
  
  // Strategy: Gemini uses a turn-based structure
  // User prompts and model responses are in separate containers
  // We need to find BOTH and merge them in order
  
  const conversationContainer = document.querySelector('main') || document.body;
  
  // Step 1: Find all user query elements
  const userSelectors = [
    '[class*="query-text"]',
    '[class*="user-query"]', 
    '[class*="prompt-text"]',
    '[data-query]',
    '.user-text',
    'p[class*="query"]'
  ];
  
  // Step 2: Find all model response elements  
  const modelSelectors = [
    '[class*="response-container"] .markdown',
    '[class*="model-response"]',
    '[class*="response-text"]',
    '.markdown-main-panel',
    '[class*="message-content"]'
  ];
  
  // Alternative: Look for turn containers that have both
  const turnContainers = conversationContainer.querySelectorAll('[class*="conversation-container"] > div, [class*="chat-history"] > div');
  
  // Collect all message elements with position info
  const allMessageData = [];
  
  // Method 1: Try to find explicit user/model containers
  const findMessages = (selectors, role) => {
    for (const selector of selectors) {
      try {
        const elements = conversationContainer.querySelectorAll(selector);
        elements.forEach(el => {
          const text = el.innerText?.trim();
          if (text && text.length > 5 && !shouldFilterLine(text)) {
            const rect = el.getBoundingClientRect();
            allMessageData.push({
              el,
              text,
              role,
              top: rect.top + window.scrollY
            });
          }
        });
      } catch(e) {}
    }
  };
  
  findMessages(userSelectors, 'user');
  findMessages(modelSelectors, 'assistant');
  
  // Method 2: If we didn't find enough, use a smarter DOM walk
  if (allMessageData.length < 2) {
    allMessageData.length = 0; // Clear
    
    // Look for the conversation structure more broadly
    // Gemini typically alternates: user input -> model response
    
    // Find all substantial text blocks
    const allBlocks = conversationContainer.querySelectorAll('div, p, article, section');
    const processedTexts = new Set();
    
    for (const block of allBlocks) {
      // Skip UI elements
      if (block.closest('nav, aside, footer, header, [role="navigation"], [class*="sidebar"], [class*="drawer"]')) continue;
      if (block.querySelector('input, textarea, button[type="submit"]')) continue;
      
      const text = block.innerText?.trim();
      if (!text || text.length < 15) continue;
      
      // Skip if we already processed this text (parent-child overlap)
      const textSig = text.substring(0, 100);
      if (processedTexts.has(textSig)) continue;
      
      // Check if this is a "leaf" text container (no substantial children with same text)
      const childTexts = Array.from(block.children).map(c => c.innerText?.trim()).join('');
      // If children have most of the text, skip this container (we'll process children)
      if (childTexts.length > text.length * 0.8 && block.children.length > 0) continue;
      
      // Skip very short non-substantive text
      if (shouldFilterLine(text)) continue;
      
      const rect = block.getBoundingClientRect();
      if (rect.width < 200 || rect.height < 20) continue;
      
      // Determine role from classes
      const classes = (block.className + ' ' + (block.parentElement?.className || '')).toLowerCase();
      let role = 'unknown';
      
      if (classes.match(/user|query|prompt|human|input-/)) {
        role = 'user';
      } else if (classes.match(/model|response|assistant|output|answer|markdown/)) {
        role = 'assistant';
      }
      
      processedTexts.add(textSig);
      allMessageData.push({
        el: block,
        text,
        role,
        top: rect.top + window.scrollY
      });
    }
  }
  
  // Sort by vertical position
  allMessageData.sort((a, b) => a.top - b.top);
  
  // Deduplicate overlapping messages (keep the one with more specific role)
  const dedupedMessages = [];
  for (const msg of allMessageData) {
    let dominated = false;
    
    for (let i = dedupedMessages.length - 1; i >= 0; i--) {
      const existing = dedupedMessages[i];
      
      // Check for text overlap
      if (existing.text.includes(msg.text) || msg.text.includes(existing.text)) {
        // Keep the one with known role, or the longer one
        if (msg.role !== 'unknown' && existing.role === 'unknown') {
          dedupedMessages[i] = msg;
        } else if (msg.text.length > existing.text.length && msg.role !== 'unknown') {
          dedupedMessages[i] = msg;
        }
        dominated = true;
        break;
      }
    }
    
    if (!dominated) {
      dedupedMessages.push(msg);
    }
  }
  
  // Now assign roles based on alternation if unknown
  // First message should be user (they asked something)
  for (let i = 0; i < dedupedMessages.length; i++) {
    const msg = dedupedMessages[i];
    
    if (msg.role === 'unknown') {
      // Use heuristics
      const hasStructure = msg.el.querySelector('pre, code, ul, ol, h1, h2, h3, table');
      const isLong = msg.text.length > 400;
      const prevRole = i > 0 ? dedupedMessages[i-1].role : null;
      
      if (hasStructure || isLong) {
        msg.role = 'assistant';
      } else if (i === 0 || prevRole === 'assistant') {
        msg.role = 'user';
      } else {
        msg.role = 'assistant';
      }
    }
  }
  
  // Pre-scan: Find ALL user-uploaded images in the conversation to ensure none are missed
  const allConversationImages = [];
  const mainContainer = document.querySelector('main') || document.body;
  const allGeminiImages = mainContainer.querySelectorAll('img[src*="googleusercontent"], img[src*="lh3.google"]');
  console.log(`📷 Pre-scan: Found ${allGeminiImages.length} total Google images in conversation`);
  
  for (const img of allGeminiImages) {
    // Filter out sidebar/nav images
    if (img.closest('aside, nav, [role="navigation"], [class*="sidebar"], [class*="drawer"], [class*="header"]')) {
      continue;
    }
    // Filter out tiny images
    const rect = img.getBoundingClientRect();
    if (rect.width < 50 || rect.height < 50) continue;
    
    allConversationImages.push({
      img,
      top: rect.top + window.scrollY,
      src: img.src,
      assigned: false
    });
    console.log(`📷 Pre-scan: User image at Y=${(rect.top + window.scrollY).toFixed(0)}, src=${img.src.substring(0, 60)}`);
  }
  
  // Build final messages array
  for (const msg of dedupedMessages) {
    const el = msg.el;
    let text = cleanText(msg.text, false);
    
    // Extract code blocks
    const codeBlocks = extractCodeBlocks(el, messages.length);
    for (const cb of codeBlocks) {
      text = text.replace(cb.code, cb.id);
    }
    
    // Extract images - for user messages, look in the message element itself first
    let images = await extractImages(el, msg.role);
    
    // For Gemini user messages, search more thoroughly for images
    if (msg.role === 'user' && images.length === 0) {
      console.log('📷 No images in direct element, searching parent containers...');
      
      // Search up to 6 levels of parents - don't require specific class names
      // Just avoid going into sidebar/nav containers
      let parent = el.parentElement;
      for (let lvl = 0; lvl < 6 && parent && images.length === 0; lvl++) {
        // Stop if we hit main, body, or navigation elements
        if (parent.tagName === 'MAIN' || parent.tagName === 'BODY') break;
        if (parent.closest('aside, nav, [role="navigation"], [class*="sidebar"]')) break;
        
        console.log(`📷 Checking parent level ${lvl}: <${parent.tagName}> class="${(parent.className || '').substring(0, 50)}"`);
        images = await extractImages(parent, msg.role);
        parent = parent.parentElement;
      }
    }
    
    // Also check for images in preceding siblings (Gemini sometimes puts image preview before text)
    if (msg.role === 'user' && images.length === 0) {
      console.log('📷 No images in parents, checking siblings...');
      let prevSibling = el.previousElementSibling;
      for (let i = 0; i < 5 && prevSibling; i++) {
        // Check siblings that might contain images (don't require small text)
        const siblingImages = await extractImages(prevSibling, msg.role);
        if (siblingImages.length > 0) {
          console.log(`📷 Found ${siblingImages.length} images in sibling ${i}`);
          images.push(...siblingImages);
          break;
        }
        prevSibling = prevSibling.previousElementSibling;
      }
    }
    
    // Last resort: check following siblings too
    if (msg.role === 'user' && images.length === 0) {
      let nextSibling = el.nextElementSibling;
      for (let i = 0; i < 3 && nextSibling; i++) {
        const siblingImages = await extractImages(nextSibling, msg.role);
        if (siblingImages.length > 0) {
          console.log(`📷 Found ${siblingImages.length} images in next sibling ${i}`);
          images.push(...siblingImages);
          break;
        }
        nextSibling = nextSibling.nextElementSibling;
      }
    }
    
    // FINAL fallback: Use pre-scanned images based on vertical position
    // Assign images that are positioned just above this message element
    if (msg.role === 'user' && images.length === 0 && allConversationImages.length > 0) {
      const msgRect = el.getBoundingClientRect();
      const msgTop = msgRect.top + window.scrollY;
      
      console.log(`📷 Fallback: Looking for pre-scanned images near msgTop=${msgTop.toFixed(0)}`);
      
      // Find images that are positioned within 300px above this message and not yet assigned
      for (const imgData of allConversationImages) {
        if (imgData.assigned) continue;
        const diff = msgTop - imgData.top;
        // Image should be above the message text (diff > 0) and within 300px
        if (diff >= -50 && diff <= 300) {
          console.log(`📷 Fallback: Assigning image at Y=${imgData.top.toFixed(0)} to message at Y=${msgTop.toFixed(0)} (diff=${diff.toFixed(0)})`);
          // We need to capture this image
          const capturedImages = await extractImages(imgData.img.parentElement, msg.role);
          if (capturedImages.length > 0) {
            images.push(...capturedImages);
            imgData.assigned = true;
          }
        }
      }
    }
    
    messages.push({
      role: msg.role,
      text: formatMessageText(text),
      codeBlocks,
      images
    });
  }
  
  // Fallback if nothing found
  if (messages.length === 0) {
    console.log('Using full page fallback extraction');
    const main = document.querySelector('main') || document.body;
    const clone = main.cloneNode(true);
    clone.querySelectorAll('nav, aside, [class*="sidebar"], button, input, textarea, svg').forEach(e => e.remove());
    const text = cleanText(clone.innerText || '', false);
    if (text.length > 50) {
      messages.push({ role: 'assistant', text: formatMessageText(text), codeBlocks: [], images: [] });
    }
  }
  
  console.log(`📊 Extracted ${messages.length} messages from Gemini (${messages.filter(m=>m.role==='user').length} user, ${messages.filter(m=>m.role==='assistant').length} assistant)`);
  
  return { title, messages };
}

// Helper: Extract code blocks from an element
function extractCodeBlocks(element, messageIndex) {
  const codeBlocks = [];
  const codeElements = element.querySelectorAll('pre');
  
  codeElements.forEach((pre, idx) => {
    const codeEl = pre.querySelector('code') || pre;
    const code = codeEl.innerText?.trim();
    
    if (code && code.length > 5) {
      // Detect language
      const langClass = codeEl.className?.match(/language-(\w+)/);
      const headerEl = pre.previousElementSibling;
      const headerLang = headerEl?.innerText?.toLowerCase().match(/^(javascript|python|java|typescript|html|css|bash|sh|sql|json|xml|c\+\+|c|ruby|go|rust|php|swift|kotlin)/);
      
      const lang = langClass?.[1] || headerLang?.[1] || 'code';
      const id = `[CODE_BLOCK_${messageIndex}_${idx}]`;
      
      codeBlocks.push({ id, language: lang, code });
    }
  });
  
  return codeBlocks;
}

// Helper: Convert image to base64 data URL
// Helper: Fetch image as base64 using multiple methods
async function imageToBase64(imgElement) {
  const src = imgElement.src;
  
  // Method 1: If already a data URL, return as-is
  if (src.startsWith('data:')) {
    return src;
  }
  
  const isGoogleImage = src.includes('googleusercontent') || src.includes('ggpht') || src.includes('lh3.google');
  
  // Method 2: Try fetching the image directly (works for same-origin or CORS-enabled)
  // For Google images, don't use credentials (they return Access-Control-Allow-Origin: *)
  try {
    const response = await fetch(src, { 
      mode: 'cors', 
      credentials: isGoogleImage ? 'omit' : 'include' 
    });
    if (response.ok) {
      const blob = await response.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    }
  } catch (e) {
    console.log('Fetch method failed, trying canvas...', e.message);
  }
  
  // Method 3: Try canvas approach with crossOrigin
  try {
    return await new Promise((resolve) => {
      const tempImg = new Image();
      tempImg.crossOrigin = 'anonymous';
      
      tempImg.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          
          const width = tempImg.naturalWidth || tempImg.width || 300;
          const height = tempImg.naturalHeight || tempImg.height || 200;
          
          // Limit max size
          const maxDim = 800;
          let finalWidth = width;
          let finalHeight = height;
          
          if (width > maxDim || height > maxDim) {
            const ratio = Math.min(maxDim / width, maxDim / height);
            finalWidth = Math.floor(width * ratio);
            finalHeight = Math.floor(height * ratio);
          }
          
          canvas.width = finalWidth;
          canvas.height = finalHeight;
          
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, finalWidth, finalHeight);
          ctx.drawImage(tempImg, 0, 0, finalWidth, finalHeight);
          
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          resolve(dataUrl);
        } catch (canvasError) {
          console.warn('Canvas draw failed:', canvasError);
          resolve(null);
        }
      };
      
      tempImg.onerror = () => {
        console.warn('Image load failed for:', src);
        resolve(null);
      };
      
      // Add cache buster and try loading
      tempImg.src = src + (src.includes('?') ? '&' : '?') + '_t=' + Date.now();
      
      // Timeout fallback
      setTimeout(() => resolve(null), 5000);
    });
  } catch (e) {
    console.warn('Canvas method failed:', e);
  }
  
  // Method 4: Last resort - try original canvas without crossOrigin
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    const width = imgElement.naturalWidth || imgElement.width || 300;
    const height = imgElement.naturalHeight || imgElement.height || 200;
    
    const maxDim = 800;
    let finalWidth = width;
    let finalHeight = height;
    
    if (width > maxDim || height > maxDim) {
      const ratio = Math.min(maxDim / width, maxDim / height);
      finalWidth = Math.floor(width * ratio);
      finalHeight = Math.floor(height * ratio);
    }
    
    canvas.width = finalWidth;
    canvas.height = finalHeight;
    
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, finalWidth, finalHeight);
    ctx.drawImage(imgElement, 0, 0, finalWidth, finalHeight);
    
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch (e) {
    console.warn('Final canvas attempt failed:', e);
    return null;
  }
}

// Helper: Extract images from an element (improved for Gemini, Claude, ChatGPT)
async function extractImages(element, role = 'user') {
  const images = [];
  
  // Platform detection
  const isGeminiPage = window.location.hostname.includes('gemini.google.com');
  const isClaudePage = window.location.hostname.includes('claude.ai');
  const isChatGPTPage = window.location.hostname.includes('chatgpt.com') || window.location.hostname.includes('chat.openai.com');
  
  const foundImages = new Set();
  
  // ===== GEMINI-SPECIFIC IMAGE DETECTION =====
  if (isGeminiPage) {
    // First, check if element is in the main conversation area (not sidebar/nav)
    const isInConversation = element.closest('main') && !element.closest('aside, nav, [role="navigation"], [class*="sidebar"], [class*="drawer"]');
    
    if (isInConversation) {
      // Gemini user uploads: Look for images with lh3.googleusercontent.com URLs
      // These are typically in img elements with "upload" or "preview" in alt text
      const geminiImgs = element.querySelectorAll('img[src*="googleusercontent"], img[src*="lh3.google"]');
      geminiImgs.forEach(img => {
        // Verify it's NOT in sidebar/nav/profile section
        if (img.closest('aside, nav, [role="navigation"], [class*="sidebar"], [class*="drawer"], [class*="header"], [class*="profile"], [class*="avatar"]')) {
          return; // Skip this image
        }
        // Verify it's a substantial image, not a tiny thumbnail
        const w = img.naturalWidth || img.width || img.offsetWidth || 0;
        const h = img.naturalHeight || img.height || img.offsetHeight || 0;
        if (w >= 50 || h >= 50) {
          foundImages.add(img);
        }
      });
      
      // Also look for images with specific Gemini upload classes/patterns
      const uploadImgs = element.querySelectorAll('img[alt*="Uploaded"], img[alt*="Image of"], img[class*="upload"], img[class*="preview"]');
      uploadImgs.forEach(img => {
        // Verify it's NOT in sidebar/nav/profile section
        if (img.closest('aside, nav, [role="navigation"], [class*="sidebar"], [class*="drawer"], [class*="header"], [class*="profile"], [class*="avatar"]')) {
          return; // Skip this image
        }
        const src = img.src || '';
        // Only include if it's a real image (not a base64 icon or data uri icon)
        if (src.includes('googleusercontent') || src.includes('lh3.google') || (src.startsWith('http') && !src.includes('icon'))) {
          foundImages.add(img);
        }
      });
    }
  }
  
  // ===== CLAUDE-SPECIFIC IMAGE DETECTION =====
  if (isClaudePage) {
    // Claude uses blob: URLs for uploaded images
    const claudeImgs = element.querySelectorAll('img[src^="blob:"], img[src*="claude"], img[class*="upload"]');
    claudeImgs.forEach(img => foundImages.add(img));
    
    // Also check for images in file preview containers
    const previewContainers = element.querySelectorAll('[class*="file-preview"], [class*="attachment"]');
    previewContainers.forEach(container => {
      const imgs = container.querySelectorAll('img');
      imgs.forEach(img => foundImages.add(img));
    });
  }
  
  // ===== CHATGPT-SPECIFIC IMAGE DETECTION =====
  if (isChatGPTPage) {
    // ChatGPT uses oaiusercontent.com or blob URLs
    const gptImgs = element.querySelectorAll('img[src*="oaiusercontent"], img[src^="blob:"], img[src*="openai"]');
    gptImgs.forEach(img => foundImages.add(img));
    
    // Also check for DALL-E generated images
    const dalleImgs = element.querySelectorAll('img[alt*="DALL"], img[alt*="Generated"]');
    dalleImgs.forEach(img => foundImages.add(img));
  }
  
  // ===== GENERIC FALLBACK =====
  // If no platform-specific images found, use generic approach
  if (foundImages.size === 0) {
    const genericSelectors = [
      'img[src^="http"]:not([src*="icon"]):not([src*="logo"]):not([src*="avatar"]):not([width="16"]):not([width="24"])',
      'img[class*="upload"]',
      'img[class*="attachment"]',
      'img[class*="preview"]'
    ];
    
    for (const selector of genericSelectors) {
      try {
        const imgs = element.querySelectorAll(selector);
        imgs.forEach(img => {
          const w = img.naturalWidth || img.width || 0;
          const h = img.naturalHeight || img.height || 0;
          // Only include substantial images
          if (w >= 80 || h >= 80) {
            foundImages.add(img);
          }
        });
      } catch(e) {}
    }
  }
  
  // Log what we found for debugging
  console.log(`📷 Found ${foundImages.size} potential images in element (role=${role})`);
  for (const img of foundImages) {
    const src = img.src || '';
    const alt = img.alt || '';
    const rect = img.getBoundingClientRect();
    const inMain = !!img.closest('main');
    const inAside = !!img.closest('aside, nav, [class*="sidebar"]');
    console.log(`📷 - Image: alt="${alt.substring(0, 40)}" inMain=${inMain} inAside=${inAside} rect=${rect.width.toFixed(0)}x${rect.height.toFixed(0)} src=${src.substring(0, 80)}`);
  }
  
  // Helper function to capture image via tab screenshot
  async function captureImageViaScreenshot(imgElement) {
    if (!imgElement) {
      console.log('📷 Screenshot method - no imgElement');
      return null;
    }
    if (imgElement._isBackgroundImage) {
      console.log('📷 Screenshot method - skipping background image');
      return null;
    }
    
    try {
      // First check if image has valid dimensions
      let rect = imgElement.getBoundingClientRect();
      console.log('📷 Screenshot method - initial rect:', rect.width.toFixed(0), 'x', rect.height.toFixed(0), 'at', rect.x.toFixed(0), ',', rect.y.toFixed(0));
      
      if (rect.width < 10 || rect.height < 10) {
        console.log('📷 Screenshot method - image too small:', rect.width, 'x', rect.height);
        return null;
      }
      
      // Check if image is outside viewport - if so, scroll it into view
      const isOutsideViewport = rect.bottom < 0 || rect.top > window.innerHeight || 
                                 rect.right < 0 || rect.left > window.innerWidth;
      
      if (isOutsideViewport) {
        console.log('📷 Screenshot method - scrolling image into view...');
        
        // Scroll image into view with some padding
        imgElement.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
        
        // Wait for scroll to complete and rendering to settle
        await new Promise(r => setTimeout(r, 200));
        
        // Get updated rect after scroll
        rect = imgElement.getBoundingClientRect();
        console.log('📷 Screenshot method - rect after scroll:', rect.width.toFixed(0), 'x', rect.height.toFixed(0), 'at', rect.x.toFixed(0), ',', rect.y.toFixed(0));
        
        // Check if now visible
        if (rect.bottom < 0 || rect.top > window.innerHeight || 
            rect.right < 0 || rect.left > window.innerWidth) {
          console.log('📷 Screenshot method - image still not visible after scroll');
          return null;
        }
      }
      
      console.log('📷 Screenshot method - capturing image at:', rect.x.toFixed(0), rect.y.toFixed(0), rect.width.toFixed(0), rect.height.toFixed(0));
      
      // Request screenshot from background
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { 
            type: 'CAPTURE_IMAGE_REGION', 
            rect: {
              x: Math.max(0, rect.x),
              y: Math.max(0, rect.y),
              width: Math.min(rect.width, window.innerWidth - rect.x),
              height: Math.min(rect.height, window.innerHeight - rect.y)
            }
          },
          (resp) => {
            if (chrome.runtime.lastError) {
              console.log('📷 Screenshot method error:', chrome.runtime.lastError.message);
              resolve(null);
            } else {
              resolve(resp);
            }
          }
        );
        setTimeout(() => resolve(null), 5000);
      });
      
      if (!response || !response.success || !response.dataUrl) {
        console.log('📷 Screenshot capture failed:', response?.error);
        return null;
      }
      
      // Crop the screenshot to the image region
      const screenRect = response.rect;
      const devicePixelRatio = window.devicePixelRatio || 1;
      
      return new Promise((resolve) => {
        const tempImg = new Image();
        tempImg.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            // Calculate crop region (accounting for device pixel ratio)
            const cropX = screenRect.x * devicePixelRatio;
            const cropY = screenRect.y * devicePixelRatio;
            const cropW = screenRect.width * devicePixelRatio;
            const cropH = screenRect.height * devicePixelRatio;
            
            canvas.width = Math.min(cropW, 800);
            canvas.height = Math.min(cropH, 600);
            
            ctx.drawImage(
              tempImg,
              cropX, cropY, cropW, cropH,  // source
              0, 0, canvas.width, canvas.height  // destination
            );
            
            const result = canvas.toDataURL('image/jpeg', 0.85);
            console.log('📷 Screenshot cropped successfully, size:', result.length);
            resolve(result);
          } catch (e) {
            console.log('📷 Screenshot crop failed:', e.message);
            resolve(null);
          }
        };
        tempImg.onerror = () => resolve(null);
        tempImg.src = response.dataUrl;
      });
    } catch (e) {
      console.log('📷 Screenshot method error:', e.message);
      return null;
    }
  }
  
  // Save original scroll position to restore after capturing all images
  const originalScrollY = window.scrollY;
  const originalScrollX = window.scrollX;
  
  for (const img of foundImages) {
    const src = img.src || img._isBackgroundImage && img.src;
    if (!src) continue;
    
    const alt = img.alt || 'Uploaded image';
    
    // Skip hidden images
    const computedStyle = window.getComputedStyle(img);
    if (computedStyle.display === 'none' || computedStyle.visibility === 'hidden' || computedStyle.opacity === '0') {
      console.log('📷 Skipping hidden image');
      continue;
    }
    
    // Get accurate dimensions
    const rect = img.getBoundingClientRect();
    const width = img.naturalWidth || img.width || rect.width || 0;
    const height = img.naturalHeight || img.height || rect.height || 0;
    
    // Skip tiny icons and logos (more strict - 50px minimum)
    if (width > 0 && width < 50 && height > 0 && height < 50) {
      console.log('📷 Skipping tiny image:', width, 'x', height);
      continue;
    }
    
    // Skip known icon patterns in URL
    if (src.includes('/icon') || src.includes('favicon') || src.includes('/logo')) continue;
    
    // Skip profile pictures and avatars (check class and alt text)
    const parentClasses = (img.parentElement?.className || '').toLowerCase();
    const imgClasses = (img.className || '').toLowerCase();
    const altLower = alt.toLowerCase();
    
    if (imgClasses.match(/avatar|profile/) || parentClasses.match(/avatar|profile/) || altLower.match(/^avatar|^profile pic/)) {
      console.log('📷 Skipping avatar/profile image');
      continue;
    }
    
    // Skip images that are clearly UI decorations (very small or specific patterns)
    // But allow Google's lh3 images which are user uploads
    const isUserUpload = src.includes('googleusercontent') || src.includes('lh3.google') || src.includes('ggpht');
    
    if (!isUserUpload) {
      // Only apply strict filtering to non-user-upload images
      if ((width > 0 && width < 80) || (height > 0 && height < 80)) {
        console.log('📷 Skipping small decorative image:', width, 'x', height);
        continue;
      }
    }
    
    console.log('📷 Attempting to capture image:', alt, src.substring(0, 80));
    
    let base64 = null;
    const isGoogleImage = src.includes('googleusercontent') || src.includes('ggpht') || src.includes('lh3.google');
    
    // Method 0: For Google images, try screenshot capture first (most reliable)
    if (!base64 && isGoogleImage && !img._isBackgroundImage && chrome?.runtime?.sendMessage) {
      console.log('📷 Method 0: Trying screenshot capture for Google image...');
      base64 = await captureImageViaScreenshot(img);
      if (base64) console.log('📷 Method 0 (screenshot) succeeded!');
    }
    
    // Method 1: For Google images, try fetch WITHOUT credentials first (CORS uses * which conflicts with credentials)
    if (!base64 && isGoogleImage) {
      console.log('📷 Method 1: Trying fetch without credentials for Google image...');
      try {
        // First try without following redirects to avoid CORS issues with redirect chain
        let fetchUrl = src;
        
        // Try to get the final URL by doing a HEAD request first
        try {
          const headResp = await fetch(src, { 
            method: 'HEAD',
            mode: 'cors',
            credentials: 'omit',
            redirect: 'follow'
          });
          if (headResp.ok) {
            fetchUrl = headResp.url; // Use the final URL after redirects
            console.log('📷 Method 1: Final URL after redirect:', fetchUrl.substring(0, 80));
          }
        } catch (e) {
          console.log('📷 Method 1: HEAD request failed, using original URL');
        }
        
        const response = await fetch(fetchUrl, { 
          mode: 'cors',
          credentials: 'omit',
          headers: { 'Accept': 'image/*' }
        });
        if (response.ok) {
          const blob = await response.blob();
          base64 = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
          });
          if (base64) console.log('📷 Method 1 succeeded!');
        }
      } catch (e) {
        console.log('📷 Method 1 failed:', e.message);
      }
    }
    
    // Method 2: Try using page context to capture the image (works for already-loaded images)
    if (!base64 && (isGemini || isClaude)) {
      console.log('📷 Method 2: Trying page context canvas capture...');
      try {
        // First try to find the image by src (handle URL with special chars)
        const escapedSrc = src.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "\\'");
        // Also try partial match for truncated URLs
        const srcPrefix = src.substring(0, Math.min(src.length, 100));
        const escapedPrefix = srcPrefix.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "\\'");
        
        base64 = await new Promise((resolve) => {
          const requestId = 'canvas_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
          
          const handler = (event) => {
            if (event.data && event.data.type === 'PAGE_CANVAS_RESULT' && event.data.requestId === requestId) {
              window.removeEventListener('message', handler);
              resolve(event.data.base64);
            }
          };
          window.addEventListener('message', handler);
          
          // Inject script that runs in page context where the image was loaded
          const script = document.createElement('script');
          script.textContent = `
            (function() {
              try {
                // Try exact match first
                let img = document.querySelector('img[src="${escapedSrc}"]');
                
                // If not found, try partial match
                if (!img) {
                  const imgs = document.querySelectorAll('img');
                  for (const i of imgs) {
                    if (i.src && i.src.startsWith("${escapedPrefix}")) {
                      img = i;
                      break;
                    }
                  }
                }
                
                // Also try images with googleusercontent in src
                if (!img) {
                  const imgs = document.querySelectorAll('img[src*="googleusercontent"], img[src*="ggpht"]');
                  if (imgs.length > 0) img = imgs[0];
                }
                
                console.log('[ChatArchive] Page canvas - found image:', !!img, img?.src?.substring(0,50));
                
                if (img && img.complete && img.naturalWidth > 0) {
                  const canvas = document.createElement('canvas');
                  const ctx = canvas.getContext('2d');
                  const maxDim = 800;
                  let w = img.naturalWidth, h = img.naturalHeight;
                  if (w > maxDim || h > maxDim) {
                    const ratio = Math.min(maxDim / w, maxDim / h);
                    w = Math.floor(w * ratio);
                    h = Math.floor(h * ratio);
                  }
                  canvas.width = w;
                  canvas.height = h;
                  ctx.drawImage(img, 0, 0, w, h);
                  try {
                    const data = canvas.toDataURL('image/jpeg', 0.85);
                    console.log('[ChatArchive] Page canvas - success, data length:', data?.length);
                    window.postMessage({ type: 'PAGE_CANVAS_RESULT', requestId: '${requestId}', base64: data }, '*');
                  } catch(canvasErr) {
                    console.warn('[ChatArchive] Page canvas toDataURL failed (tainted):', canvasErr.message);
                    window.postMessage({ type: 'PAGE_CANVAS_RESULT', requestId: '${requestId}', base64: null }, '*');
                  }
                } else {
                  console.log('[ChatArchive] Page canvas - image not found or not loaded');
                  window.postMessage({ type: 'PAGE_CANVAS_RESULT', requestId: '${requestId}', base64: null }, '*');
                }
              } catch(e) {
                console.warn('[ChatArchive] Page canvas capture error:', e);
                window.postMessage({ type: 'PAGE_CANVAS_RESULT', requestId: '${requestId}', base64: null }, '*');
              }
            })();
          `;
          document.head.appendChild(script);
          script.remove();
          
          setTimeout(() => {
            window.removeEventListener('message', handler);
            resolve(null);
          }, 3000);
        });
        
        if (base64) console.log('📷 Method 2 (page context canvas) succeeded!');
      } catch (e) {
        console.log('📷 Method 2 failed:', e.message);
      }
    }
    
    // Method 3: Standard imageToBase64 for non-Google images
    if (!base64 && !img._isBackgroundImage && img.complete && img.naturalWidth > 0) {
      console.log('📷 Method 3: Trying standard imageToBase64...');
      base64 = await imageToBase64(img);
      if (base64) console.log('📷 Method 3 succeeded!');
    }
    
    // Method 4: For blob URLs, try fetch with credentials
    if (!base64 && src.startsWith('blob:')) {
      console.log('📷 Method 4: Trying blob fetch with credentials...');
      try {
        const response = await fetch(src, { 
          mode: 'cors', 
          credentials: 'include',
          headers: { 'Accept': 'image/*' }
        });
        if (response.ok) {
          const blob = await response.blob();
          base64 = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
          });
          if (base64) console.log('📷 Method 4 succeeded!');
        }
      } catch (e) {
        console.log('📷 Method 4 failed:', e.message);
      }
    }
    
    // Method 5: Try direct canvas capture from existing element
    if (!base64 && !img._isBackgroundImage && img.complete) {
      console.log('📷 Method 5: Trying direct canvas...');
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const w = img.naturalWidth || img.width || 300;
        const h = img.naturalHeight || img.height || 200;
        canvas.width = Math.min(w, 800);
        canvas.height = Math.min(h, 600);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        base64 = canvas.toDataURL('image/png', 0.9);
        if (base64) console.log('📷 Method 5 succeeded!');
      } catch (e) {
        console.log('📷 Method 5 failed (tainted):', e.message);
      }
    }
    
    // Method 6: Try fetching through background script (different permissions)
    if (!base64 && !src.startsWith('blob:') && chrome?.runtime?.sendMessage) {
      console.log('📷 Method 6: Trying background script fetch...');
      try {
        const result = await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { type: 'FETCH_IMAGE_BASE64', url: src },
            (response) => {
              if (chrome.runtime.lastError) {
                console.log('📷 Method 6 runtime error:', chrome.runtime.lastError.message);
                resolve(null);
              } else if (response && response.success) {
                resolve(response.base64);
              } else {
                console.log('📷 Method 6 response error:', response?.error);
                resolve(null);
              }
            }
          );
          setTimeout(() => resolve(null), 5000);
        });
        if (result) {
          base64 = result;
          console.log('📷 Method 6 succeeded!');
        }
      } catch (e) {
        console.log('📷 Method 6 failed:', e.message);
      }
    }
    
    // Method 7: For blob URLs in Gemini/Claude, inject inline script to fetch in page context
    if (!base64 && src.startsWith('blob:') && (isGemini || isClaude)) {
      console.log('📷 Method 7: Trying inline script for blob...');
      try {
        base64 = await new Promise((resolve) => {
          const requestId = 'blob_' + Date.now();
          
          const handler = (event) => {
            if (event.data && event.data.type === 'INLINE_IMAGE_RESULT' && event.data.requestId === requestId) {
              window.removeEventListener('message', handler);
              resolve(event.data.base64);
            }
          };
          window.addEventListener('message', handler);
          
          const script = document.createElement('script');
          script.textContent = `
            (async function() {
              try {
                const response = await fetch("${src}");
                if (response.ok) {
                  const blob = await response.blob();
                  const reader = new FileReader();
                  reader.onloadend = () => {
                    window.postMessage({ type: 'INLINE_IMAGE_RESULT', requestId: '${requestId}', base64: reader.result }, '*');
                  };
                  reader.onerror = () => {
                    window.postMessage({ type: 'INLINE_IMAGE_RESULT', requestId: '${requestId}', base64: null }, '*');
                  };
                  reader.readAsDataURL(blob);
                } else {
                  window.postMessage({ type: 'INLINE_IMAGE_RESULT', requestId: '${requestId}', base64: null }, '*');
                }
              } catch(e) {
                window.postMessage({ type: 'INLINE_IMAGE_RESULT', requestId: '${requestId}', base64: null }, '*');
              }
            })();
          `;
          document.head.appendChild(script);
          script.remove();
          
          setTimeout(() => {
            window.removeEventListener('message', handler);
            resolve(null);
          }, 5000);
        });
        
        if (base64) console.log('📷 Method 7 succeeded!');
      } catch (e) {
        console.log('📷 Method 7 failed:', e.message);
      }
    }
    
    console.log('📷 Image capture result:', alt, base64 ? 'SUCCESS' : 'FAILED (will show placeholder)');
    
    images.push({ 
      src, 
      alt: alt === 'Uploaded image preview' ? 'Uploaded Image' : alt,
      width: img.naturalWidth || img.width || 300, 
      height: img.naturalHeight || img.height || 200,
      base64: base64
    });
  }
  
  // Restore original scroll position
  window.scrollTo(originalScrollX, originalScrollY);
  
  // Deduplicate images by source URL (keeping the first occurrence)
  const seenUrls = new Set();
  const dedupedImages = images.filter(img => {
    // Normalize URL for comparison (strip query params and trailing slashes)
    const normalizedUrl = img.src.split('?')[0].replace(/\/+$/, '').substring(0, 100);
    if (seenUrls.has(normalizedUrl)) {
      console.log('📷 Skipping duplicate image:', normalizedUrl.substring(0, 50));
      return false;
    }
    seenUrls.add(normalizedUrl);
    return true;
  });
  
  return dedupedImages;
}

// Helper: Format message text properly
function formatMessageText(text) {
  return text
    .replace(/\n{3,}/g, '\n\n')  // Max 2 newlines
    .replace(/^\s+|\s+$/g, '')   // Trim
    .replace(/[ \t]+$/gm, '');   // Remove trailing spaces per line
}

// Legacy function kept for compatibility
function processGeminiText(text) {
  const lines = text.split('\n');
  const cleanedLines = [];
  let foundContent = false;
  
  for (let line of lines) {
    line = line.trim();
    
    if (!line) {
      if (foundContent && cleanedLines[cleanedLines.length - 1] !== '') {
        cleanedLines.push('');
      }
      continue;
    }
    
    if (shouldFilterLine(line)) continue;
    
    line = cleanText(line, false);
    
    // Normalize bullet characters
    line = line.replace(/^[-*]\s+/g, '- ');
    
    if (line) {
      foundContent = true;
      cleanedLines.push(line);
    }
  }
  
  return cleanedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ============================================
// CLAUDE EXTRACTION  
// ============================================

async function extractClaudeContent() {
  console.log('🔍 Extracting Claude conversation...');
  
  // Scroll to load all content
  for (let i = 0; i < 20; i++) {
    window.scrollTo(0, document.body.scrollHeight);
    await wait(150);
  }
  window.scrollTo(0, 0);
  await wait(500);
  
  // Get title
  let title = document.title?.replace(/\s*[-|]\s*Claude/gi, '').replace('Claude', '').trim() || 'Claude Conversation';
  
  const messages = [];
  
  const conversationContainer = document.querySelector('main') || document.body;
  
  // Claude's DOM structure analysis:
  // - User messages and Claude responses are in distinct containers
  // - We need to find the conversation thread
  
  // Collect all message data with positions
  const allMessageData = [];
  
  // Method 1: Look for specific Claude message patterns
  // Claude often uses classes like "font-claude-message" or data attributes
  
  const claudeSpecificSelectors = [
    // Human messages
    { selector: '[class*="human"]', role: 'user' },
    { selector: '[class*="user-message"]', role: 'user' },
    { selector: '[data-testid*="human"]', role: 'user' },
    // Assistant messages  
    { selector: '[class*="assistant-message"]', role: 'assistant' },
    { selector: '[class*="claude-message"]', role: 'assistant' },
    { selector: '[data-testid*="assistant"]', role: 'assistant' },
    { selector: '.font-claude-message', role: 'assistant' }
  ];
  
  for (const { selector, role } of claudeSpecificSelectors) {
    try {
      const elements = conversationContainer.querySelectorAll(selector);
      elements.forEach(el => {
        const text = el.innerText?.trim();
        if (text && text.length > 10 && !shouldFilterLine(text)) {
          const rect = el.getBoundingClientRect();
          allMessageData.push({
            el,
            text,
            role,
            top: rect.top + window.scrollY,
            source: 'specific'
          });
        }
      });
    } catch(e) {}
  }
  
  // Method 2: If specific selectors didn't find much, do a DOM walk
  if (allMessageData.length < 2) {
    allMessageData.length = 0;
    
    // Find conversation thread containers
    const allDivs = conversationContainer.querySelectorAll('div[class]');
    const processedRects = [];
    
    for (const div of allDivs) {
      // Skip UI elements
      if (div.closest('nav, aside, footer, header, [role="navigation"], [class*="sidebar"], [class*="toolbar"]')) continue;
      if (div.querySelector('input, textarea')) continue;
      
      const text = div.innerText?.trim();
      if (!text || text.length < 15) continue;
      
      // Skip pure UI text
      if (shouldFilterLine(text)) continue;
      
      const rect = div.getBoundingClientRect();
      if (rect.width < 300 || rect.height < 30) continue;
      
      // Check if we already have a container at similar position (dedup)
      const isDuplicatePosition = processedRects.some(r => 
        Math.abs(r.top - rect.top) < 20 && Math.abs(r.height - rect.height) < 20
      );
      if (isDuplicatePosition) continue;
      
      // Get class hierarchy
      const selfClass = (div.className || '').toLowerCase();
      const parentClass = (div.parentElement?.className || '').toLowerCase();
      const gpClass = (div.parentElement?.parentElement?.className || '').toLowerCase();
      const allClasses = selfClass + ' ' + parentClass + ' ' + gpClass;
      
      // Determine role from class names
      let role = 'unknown';
      if (allClasses.match(/human|user(?!-select)/)) {
        role = 'user';
      } else if (allClasses.match(/assistant|claude|ai-response|response-content/)) {
        role = 'assistant';
      }
      
      // Skip if no role indicator and text is too short (likely UI)
      if (role === 'unknown' && text.length < 50) continue;
      
      processedRects.push(rect);
      allMessageData.push({
        el: div,
        text,
        role,
        top: rect.top + window.scrollY,
        source: 'walk'
      });
    }
  }
  
  // Sort by vertical position
  allMessageData.sort((a, b) => a.top - b.top);
  
  // Deduplicate overlapping texts
  const dedupedMessages = [];
  for (const msg of allMessageData) {
    let dominated = false;
    
    for (let i = dedupedMessages.length - 1; i >= 0; i--) {
      const existing = dedupedMessages[i];
      
      // Check for text overlap
      const overlapCheck = (a, b) => {
        if (a.length > b.length) return a.includes(b);
        return b.includes(a);
      };
      
      if (overlapCheck(existing.text, msg.text)) {
        // Keep the one with known role, or longer text if both have role
        if (msg.role !== 'unknown' && existing.role === 'unknown') {
          dedupedMessages[i] = msg;
        } else if (msg.role !== 'unknown' && msg.text.length > existing.text.length) {
          dedupedMessages[i] = msg;
        }
        dominated = true;
        break;
      }
    }
    
    if (!dominated) {
      dedupedMessages.push(msg);
    }
  }
  
  // Assign roles to unknowns using alternation and heuristics
  for (let i = 0; i < dedupedMessages.length; i++) {
    const msg = dedupedMessages[i];
    
    if (msg.role === 'unknown') {
      const hasStructure = msg.el.querySelector('pre, code, ul, ol, h1, h2, h3, table, blockquote');
      const isLong = msg.text.length > 350;
      const hasMarkdown = msg.text.includes('```') || msg.text.match(/^\s*[-*]\s+/m);
      const prevRole = i > 0 ? dedupedMessages[i-1].role : null;
      
      if (hasStructure || isLong || hasMarkdown) {
        msg.role = 'assistant';
      } else if (i === 0 || prevRole === 'assistant') {
        msg.role = 'user';
      } else {
        msg.role = 'assistant';
      }
    }
  }
  
  // Build final messages array
  for (const msg of dedupedMessages) {
    const el = msg.el;
    let text = cleanText(msg.text, false);
    
    // Skip if text became empty after cleaning
    if (!text || text.length < 5) continue;
    
    // Skip UI-only messages
    if (/^(Copy|Retry|Continue|Edit|Share|View more|Show less)$/i.test(text.trim())) continue;
    
    // Extract code blocks using helper
    const codeBlocks = extractCodeBlocks(el, messages.length);
    for (const cb of codeBlocks) {
      text = text.replace(cb.code, cb.id);
    }
    
    // Extract images (async to capture base64)
    const images = await extractImages(el);
    
    messages.push({
      role: msg.role,
      text: formatMessageText(text),
      codeBlocks,
      images
    });
  }
  
  // Fallback if nothing found
  if (messages.length === 0) {
    console.log('Using full fallback extraction for Claude');
    const main = document.querySelector('main') || document.body;
    const clone = main.cloneNode(true);
    clone.querySelectorAll('nav, aside, [class*="sidebar"], button, input, textarea, svg').forEach(e => e.remove());
    const text = cleanText(clone.innerText || '', false);
    
    if (text.length > 50) {
      // Try to split by turn indicators
      const turnPattern = /(?:^|\n\n)(?:(?:Human|You|User):\s*|(?:Assistant|Claude):\s*)/gi;
      const parts = text.split(turnPattern).filter(p => p.trim());
      
      if (parts.length > 1) {
        for (let i = 0; i < parts.length; i++) {
          const role = (i % 2 === 0) ? 'user' : 'assistant';
          messages.push({ role, text: parts[i].trim(), codeBlocks: [], images: [] });
        }
      } else {
        messages.push({ role: 'assistant', text: formatMessageText(text), codeBlocks: [], images: [] });
      }
    }
  }
  
  console.log(`📊 Extracted ${messages.length} messages from Claude (${messages.filter(m=>m.role==='user').length} user, ${messages.filter(m=>m.role==='assistant').length} assistant)`);
  
  return { title, messages };
}

// ============================================
// CHATGPT EXTRACTION
// ============================================

async function extractChatGPTContent() {
  console.log('🔍 Extracting ChatGPT conversation...');
  
  const articles = document.querySelectorAll('article');
  const messages = [];
  const titleEl = document.querySelector('h1, [class*="text-2xl"]');
  const title = titleEl?.innerText?.trim() || 'ChatGPT Conversation';
  
  articles.forEach(article => {
    let role = 'assistant';
    if (article.querySelector('[data-message-author-role="user"]')) {
      role = 'user';
    }
    
    const contentNode = article.querySelector('.markdown') || article.querySelector('[data-message-author-role] + div');
    
    if (contentNode) {
      // Clone and clean
      const clone = contentNode.cloneNode(true);
      clone.querySelectorAll('button, svg, .sr-only').forEach(el => el.remove());
      
      let text = '';
      const codeBlocks = [];
      const images = [];
      
      // Extract images first
      contentNode.querySelectorAll('img:not([class*="icon"]):not([class*="avatar"])').forEach((img, imgIdx) => {
        if (img.src && (img.naturalWidth > 50 || !img.complete)) {
          images.push({
            src: img.src,
            alt: img.alt || `Image ${imgIdx + 1}`,
            width: img.naturalWidth,
            height: img.naturalHeight
          });
        }
      });
      
      clone.childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
          const t = node.textContent.trim();
          if (t) text += t + '\n';
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const tag = node.tagName.toLowerCase();
          const content = node.innerText?.trim();
          if (!content) return;
          
          if (tag === 'pre') {
            const codeEl = node.querySelector('code');
            const code = (codeEl || node).innerText.trim();
            const lang = (codeEl?.className.match(/language-(\w+)/) || [])[1] || 'code';
            const id = `[CODE_BLOCK_${codeBlocks.length}]`;
            codeBlocks.push({ id, language: lang, code });
            text += '\n' + id + '\n';
          } else if (['h1','h2','h3','h4'].includes(tag)) {
            text += '\n## ' + content + '\n';
          } else if (tag === 'ul' || tag === 'ol') {
            node.querySelectorAll('li').forEach((li, idx) => {
              text += (tag === 'ol' ? `${idx+1}. ` : '- ') + li.innerText.trim() + '\n';
            });
          } else {
            text += content + '\n';
          }
        }
      });
      
      text = cleanText(text);
      if (text) {
        messages.push({ role, text, codeBlocks, images });
      }
    }
  });
  
  return { title, messages };
}

// ============================================
// MAIN EXTRACTION
// ============================================

async function extractConversation() {
  let result;
  
  if (isGemini) {
    result = await extractGeminiContent();
  } else if (isClaude) {
    result = await extractClaudeContent();
  } else if (isChatGPT) {
    result = await extractChatGPTContent();
  } else {
    result = { title: 'Conversation', messages: [] };
  }
  
  const date = new Date().toLocaleString();
  const stats = {
    total: result.messages.length,
    user: result.messages.filter(m => m.role === 'user').length,
    assistant: result.messages.filter(m => m.role === 'assistant').length,
    words: result.messages.reduce((acc, m) => acc + (m.text?.split(/\s+/).length || 0), 0)
  };
  
  return { title: result.title, date, stats, messages: result.messages };
}

// ============================================
// PDF GENERATION - Professional Document Style
// ============================================

function generatePDFInContentScript(data) {
  if (!jsPDFLib) {
    alert('PDF library not loaded. Please refresh.');
    return;
  }
  
  try {
    const pdf = new jsPDFLib({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const marginLeft = 40;
    const marginRight = 40;
    const marginTop = 40;
    const marginBottom = 40;
    const contentWidth = pageWidth - marginLeft - marginRight;
    let y = marginTop;
    let pageNumber = 1;
    
    // Premium color palette
    const colors = {
      aiText: [17, 24, 39],         // #111827 - Off-black for AI
      userText: [31, 41, 55],       // #1F2937 - Darker gray for user
      userBg: [243, 244, 246],      // #F3F4F6 - User bubble background
      aiBg: [255, 255, 255],        // #FFFFFF - AI bubble background
      aiBorder: [229, 231, 235],    // #E5E7EB - AI bubble border
      codeBg: [249, 250, 251],      // #F9FAFB - Code background
      codeBorder: [229, 231, 235],  // #E5E7EB - Code border
      headingText: [0, 0, 0],       // Pure black for headings
      meta: [156, 163, 175]         // #9CA3AF - Muted metadata
    };
    
    // Typography with proper vertical rhythm
    const font = {
      body: 10,
      bodyLine: 16,         // 1.6x line height for readability
      heading1: 14,         // Semibold 14pt for main headings
      heading1Line: 19,
      heading2: 12,
      heading2Line: 17,
      heading3: 11,
      heading3Line: 15,
      code: 8.5,
      codeLine: 12,
      meta: 8
    };
    
    // Semantic spacing (vertical rhythm)
    const spacing = {
      headingMarginTop: 18,    // margin: 18px 0 8px 0 for headings
      headingMarginBottom: 8,
      paragraphMarginBottom: 12,  // margin-bottom: 12px for paragraphs
      listMarginBottom: 12,       // margin-bottom: 12px for lists
      listItemMarginBottom: 6,    // margin-bottom: 6px for list items
      codeMarginY: 12,            // margin: 12px 0 for code blocks
      bubbleGap: 24               // margin-bottom: 24px between bubbles
    };
    
    // Bubble settings
    const bubble = {
      maxWidth: contentWidth * 0.80,  // 80% max-width
      padding: 16,                     // 16px vertical padding
      paddingH: 24,                    // 24px horizontal padding
      radius: 16,                      // 16px border-radius
      userTailRadius: 4,               // border-bottom-right-radius: 4px
      aiTailRadius: 4                  // border-bottom-left-radius: 4px
    };
    
    const platform = isGemini ? 'Gemini' : (isClaude ? 'Claude' : (isChatGPT ? 'ChatGPT' : 'AI'));
    
    // ========== HELPERS ==========
    
    const ensureSpace = (needed = 20) => {
      if (y + needed > pageHeight - marginBottom) {
        pdf.addPage();
        pageNumber++;
        y = marginTop;
        return true;
      }
      return false;
    };
    
    const sanitize = (text) => cleanText(text, true);
    
    // Draw rounded bubble with chat tail effect
    const drawBubble = (x, bubbleY, w, h, isUser = false) => {
      const r = bubble.radius;
      
      if (isUser) {
        // User bubble - #F3F4F6 background, tail on bottom-right
        pdf.setFillColor(...colors.userBg);
        pdf.roundedRect(x, bubbleY, w, h, r, r, 'F');
        // Sharper bottom-right corner (tail effect)
        pdf.setFillColor(...colors.userBg);
        pdf.rect(x + w - bubble.userTailRadius, bubbleY + h - bubble.userTailRadius, bubble.userTailRadius, bubble.userTailRadius, 'F');
      } else {
        // AI bubble - white with #E5E7EB border, tail on bottom-left
        pdf.setFillColor(...colors.aiBg);
        pdf.setDrawColor(...colors.aiBorder);
        pdf.setLineWidth(1);
        pdf.roundedRect(x, bubbleY, w, h, r, r, 'FD');
        // Sharper bottom-left corner (tail effect)
        pdf.setFillColor(...colors.aiBg);
        pdf.rect(x, bubbleY + h - bubble.aiTailRadius, bubble.aiTailRadius, bubble.aiTailRadius, 'F');
        // Redraw border edges for tail
        pdf.setDrawColor(...colors.aiBorder);
        pdf.line(x, bubbleY + h - bubble.aiTailRadius, x, bubbleY + h);
        pdf.line(x, bubbleY + h, x + bubble.aiTailRadius, bubbleY + h);
      }
    };
    
    // Parse **bold** markers
    const parseBold = (text) => {
      const parts = [];
      let rest = text;
      let bold = false;
      while (rest.length > 0) {
        const idx = rest.indexOf('**');
        if (idx === -1) {
          if (rest) parts.push({ text: rest, bold });
          break;
        }
        if (idx > 0) parts.push({ text: rest.substring(0, idx), bold });
        bold = !bold;
        rest = rest.substring(idx + 2);
      }
      return parts;
    };
    
    // Render text with inline bold - returns height used
    const renderBoldText = (text, x, maxW, color, fontSize, lineH, startY) => {
      let localY = startY;
      
      if (!text.includes('**')) {
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(fontSize);
        pdf.setTextColor(...color);
        const lines = pdf.splitTextToSize(text, maxW);
        lines.forEach(l => {
          pdf.text(l, x, localY);
          localY += lineH;
        });
        return localY - startY;
      }
      
      const parts = parseBold(text);
      const plain = parts.map(p => p.text).join('');
      pdf.setFontSize(fontSize);
      const wrapped = pdf.splitTextToSize(plain, maxW);
      
      for (const line of wrapped) {
        let cx = x;
        let ci = 0;
        for (const part of parts) {
          pdf.setFont('helvetica', part.bold ? 'bold' : 'normal');
          pdf.setFontSize(fontSize);
          pdf.setTextColor(...color);
          let seg = '';
          for (let i = 0; i < part.text.length && ci < line.length; i++) {
            if (part.text[i] === line[ci]) {
              seg += line[ci];
              ci++;
            }
          }
          if (seg) {
            pdf.text(seg, cx, localY);
            cx += pdf.getTextWidth(seg);
          }
        }
        localY += lineH;
      }
      return localY - startY;
    };
    
    // ========== DOCUMENT HEADER ==========
    
    const safeTitle = sanitize(data.title) || 'Conversation';
    
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(16);
    pdf.setTextColor(...colors.aiText);
    const titleLines = pdf.splitTextToSize(safeTitle, contentWidth);
    titleLines.forEach(line => {
      pdf.text(line, marginLeft, y);
      y += 22;
    });
    
    y += 2;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(font.meta);
    pdf.setTextColor(...colors.meta);
    const msgCount = data.stats?.total || data.messages.length;
    pdf.text(`${platform} • ${data.date} • ${msgCount} messages`, marginLeft, y);
    
    y += 14;
    pdf.setDrawColor(...colors.aiBorder);
    pdf.setLineWidth(0.5);
    pdf.line(marginLeft, y, pageWidth - marginRight, y);
    y += 24;
    
    // ========== MESSAGES - CONTINUOUS FLOW ==========
    
    for (let msgIdx = 0; msgIdx < data.messages.length; msgIdx++) {
      const msg = data.messages[msgIdx];
      if (!msg.text && (!msg.images || msg.images.length === 0)) continue;
      
      let text = sanitize(msg.text) || '';
      
      // Replace code block placeholders
      if (msg.codeBlocks?.length) {
        msg.codeBlocks.forEach(b => {
          const code = sanitize(b.code);
          text = text.replace(b.id, `\n<<<CODE:${b.language}>>>\n${code}\n<<</CODE>>>\n`);
        });
      }
      
      const isUser = msg.role === 'user';
      const images = msg.images || [];
      const textColor = isUser ? colors.userText : colors.aiText;
      
      const bubbleMaxW = bubble.maxWidth;
      const textMaxW = bubbleMaxW - (bubble.paddingH * 2);
      
      // ========== CALCULATE BUBBLE HEIGHT WITH SEMANTIC SPACING ==========
      let contentHeight = 0;
      const lines = text.split('\n');
      let prevLineType = null; // Track previous line type for proper spacing
      
      // User images first
      if (isUser && images.length) {
        images.forEach(img => {
          if (img?.base64) {
            let iw = Math.min(img.width || 200, textMaxW);
            let ih = (img.height || 150) * (iw / (img.width || 200));
            if (ih > 180) ih = 180;
            contentHeight += ih + spacing.paragraphMarginBottom;
          }
        });
      }
      
      // Parse each line for height calculation
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        if (!line.trim()) {
          contentHeight += 6; // Empty line spacing
          continue;
        }
        
        if (line.match(/^<<<IMG:(\d+)>>>$/)) continue;
        
        // Code block
        if (line.match(/^<<<CODE:/)) {
          if (prevLineType) contentHeight += spacing.codeMarginY;
          contentHeight += 20;
          prevLineType = 'code-start';
          continue;
        }
        if (line.match(/^<<<\/CODE>>>$/)) {
          contentHeight += spacing.codeMarginY;
          prevLineType = 'code-end';
          continue;
        }
        
        // Headers
        if (line.match(/^#{1,3}\s+/)) {
          contentHeight += spacing.headingMarginTop;
          pdf.setFontSize(font.heading1);
          const wrapped = pdf.splitTextToSize(line.replace(/^#+\s+/, ''), textMaxW);
          contentHeight += wrapped.length * font.heading1Line;
          contentHeight += spacing.headingMarginBottom;
          prevLineType = 'heading';
          continue;
        }
        
        // Bullet / numbered list
        if (line.match(/^[-*•]\s+/) || line.match(/^\d+[.)]\s+/) || line.match(/^\s{2,}[-*•]\s+/)) {
          pdf.setFontSize(font.body);
          const content = line.replace(/^[\s\-*•\d.)\]]+/, '');
          const wrapped = pdf.splitTextToSize(content, textMaxW - 20);
          contentHeight += wrapped.length * font.bodyLine + spacing.listItemMarginBottom;
          prevLineType = 'list';
          continue;
        }
        
        // Regular paragraph
        pdf.setFontSize(font.body);
        const wrapped = pdf.splitTextToSize(line, textMaxW);
        contentHeight += wrapped.length * font.bodyLine;
        if (prevLineType === 'paragraph' || !prevLineType) {
          contentHeight += spacing.paragraphMarginBottom;
        }
        prevLineType = 'paragraph';
      }
      
      // AI images at end
      if (!isUser && images.length) {
        images.forEach(img => {
          if (img?.base64) {
            let iw = Math.min(img.width || 300, textMaxW);
            let ih = (img.height || 200) * (iw / (img.width || 300));
            if (ih > 220) ih = 220;
            contentHeight += ih + spacing.paragraphMarginBottom;
          }
        });
      }
      
      const bubbleH = contentHeight + (bubble.padding * 2) + 8;
      const bubbleW = bubbleMaxW;
      
      // Position: User = right-aligned, AI = left-aligned
      const bubbleX = isUser 
        ? pageWidth - marginRight - bubbleW
        : marginLeft;
      
      // Ensure space - continuous flow, no forced page breaks
      ensureSpace(Math.min(bubbleH, 200) + spacing.bubbleGap);
      
      const bubbleY = y;
      
      // Draw bubble background
      drawBubble(bubbleX, bubbleY, bubbleW, bubbleH, isUser);
      
      // ========== RENDER CONTENT WITH SEMANTIC HIERARCHY ==========
      let contentY = bubbleY + bubble.padding + 12;
      const contentX = bubbleX + bubble.paddingH;
      let lastElementType = null;
      
      // User images first
      if (isUser && images.length) {
        for (const imgData of images) {
          if (imgData?.base64) {
            let iw = Math.min(imgData.width || 200, textMaxW);
            let ih = (imgData.height || 150) * (iw / (imgData.width || 200));
            if (ih > 180) { ih = 180; iw = (imgData.width || 200) * (ih / (imgData.height || 150)); }
            try {
              pdf.addImage(imgData.base64, 'JPEG', contentX, contentY, iw, ih);
              contentY += ih + spacing.paragraphMarginBottom;
            } catch(e) {
              pdf.setFont('helvetica', 'italic');
              pdf.setFontSize(font.body);
              pdf.setTextColor(...colors.meta);
              pdf.text('[Image]', contentX, contentY);
              contentY += font.bodyLine;
            }
          }
        }
      }
      
      // Render text with proper semantic spacing
      let inCode = false;
      
      for (let li = 0; li < lines.length; li++) {
        const line = lines[li];
        
        if (line.match(/^<<<IMG:(\d+)>>>$/)) continue;
        
        // Empty line
        if (!line.trim()) {
          contentY += 6;
          continue;
        }
        
        // ===== CODE BLOCK START =====
        if (line.match(/^<<<CODE:?(.*)>>>$/i)) {
          inCode = true;
          const codeLang = line.match(/^<<<CODE:?(.*)>>>$/i)?.[1] || '';
          
          // margin-top before code
          if (lastElementType) contentY += spacing.codeMarginY;
          
          // Draw code block container
          const codeStartY = contentY - 4;
          
          // Language label
          if (codeLang) {
            pdf.setFont('courier', 'normal');
            pdf.setFontSize(font.meta);
            pdf.setTextColor(...colors.meta);
            pdf.text(codeLang.toLowerCase(), contentX + 12, contentY + 4);
            contentY += 14;
          }
          
          lastElementType = 'code';
          continue;
        }
        
        // ===== CODE BLOCK END =====
        if (line.match(/^<<<\/CODE>>>$/i)) {
          inCode = false;
          contentY += spacing.codeMarginY;
          lastElementType = 'code';
          continue;
        }
        
        // ===== CODE CONTENT =====
        if (inCode) {
          // Light background with border
          pdf.setFillColor(...colors.codeBg);
          pdf.setDrawColor(...colors.codeBorder);
          pdf.setLineWidth(0.5);
          pdf.rect(contentX - 12, contentY - 10, textMaxW + 24, font.codeLine + 4, 'F');
          
          pdf.setFont('courier', 'normal');
          pdf.setFontSize(font.code);
          pdf.setTextColor(...colors.aiText);
          let codeLine = line.length > 75 ? line.substring(0, 72) + '...' : line;
          pdf.text(codeLine, contentX, contentY);
          contentY += font.codeLine;
          continue;
        }
        
        // ===== HEADINGS (h1, h2, h3) - margin: 18px 0 8px 0 =====
        const h1Match = line.match(/^#{1,2}\s+(.+)$/);
        if (h1Match) {
          contentY += spacing.headingMarginTop;
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(font.heading1);
          pdf.setTextColor(...colors.headingText);
          const hLines = pdf.splitTextToSize(sanitize(h1Match[1]), textMaxW);
          hLines.forEach(hl => {
            pdf.text(hl, contentX, contentY);
            contentY += font.heading1Line;
          });
          contentY += spacing.headingMarginBottom;
          lastElementType = 'heading';
          continue;
        }
        
        const h3Match = line.match(/^#{3,}\s+(.+)$/);
        if (h3Match) {
          contentY += spacing.headingMarginTop - 4;
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(font.heading2);
          pdf.setTextColor(...colors.headingText);
          const hLines = pdf.splitTextToSize(sanitize(h3Match[1]), textMaxW);
          hLines.forEach(hl => {
            pdf.text(hl, contentX, contentY);
            contentY += font.heading2Line;
          });
          contentY += spacing.headingMarginBottom - 2;
          lastElementType = 'heading';
          continue;
        }
        
        // ===== NUMBERED LISTS - margin-left: 20px, li margin-bottom: 6px =====
        const numMatch = line.match(/^(\d+)[.)]\s+(.+)$/);
        if (numMatch) {
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(font.body);
          pdf.setTextColor(...textColor);
          
          // Number with proper indent
          pdf.text(`${numMatch[1]}.`, contentX, contentY);
          
          const numContent = sanitize(numMatch[2]);
          const numLines = pdf.splitTextToSize(numContent, textMaxW - 20);
          numLines.forEach((nl, idx) => {
            pdf.text(nl, contentX + 20, contentY + (idx * font.bodyLine));
          });
          contentY += numLines.length * font.bodyLine + spacing.listItemMarginBottom;
          lastElementType = 'list';
          continue;
        }
        
        // ===== BULLET POINTS - list-style-position: outside, 1.2em indent =====
        const bulletMatch = line.match(/^[-*•]\s+(.+)$/);
        if (bulletMatch) {
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(font.body);
          pdf.setTextColor(...textColor);
          
          // Bullet outside, text indented
          pdf.text('•', contentX, contentY);
          
          const bulletContent = sanitize(bulletMatch[1]);
          const bLines = pdf.splitTextToSize(bulletContent, textMaxW - 14);
          bLines.forEach((bl, idx) => {
            pdf.text(bl, contentX + 14, contentY + (idx * font.bodyLine));
          });
          contentY += bLines.length * font.bodyLine + spacing.listItemMarginBottom;
          lastElementType = 'list';
          continue;
        }
        
        // ===== SUB-BULLETS (nested) =====
        const subMatch = line.match(/^\s{2,}[-*•]\s+(.+)$/);
        if (subMatch) {
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(font.body);
          pdf.setTextColor(...textColor);
          
          pdf.text('◦', contentX + 14, contentY);
          
          const subContent = sanitize(subMatch[1]);
          const sLines = pdf.splitTextToSize(subContent, textMaxW - 28);
          sLines.forEach((sl, idx) => {
            pdf.text(sl, contentX + 26, contentY + (idx * font.bodyLine));
          });
          contentY += sLines.length * font.bodyLine + spacing.listItemMarginBottom;
          lastElementType = 'list';
          continue;
        }
        
        // ===== BLOCKQUOTES =====
        const quoteMatch = line.match(/^>\s*(.+)$/);
        if (quoteMatch) {
          contentY += 4;
          pdf.setDrawColor(...colors.aiBorder);
          pdf.setLineWidth(2);
          pdf.line(contentX, contentY - 10, contentX, contentY + 6);
          
          pdf.setFont('helvetica', 'italic');
          pdf.setFontSize(font.body);
          pdf.setTextColor(...colors.meta);
          const qLines = pdf.splitTextToSize(sanitize(quoteMatch[1]), textMaxW - 16);
          qLines.forEach(ql => {
            pdf.text(ql, contentX + 14, contentY);
            contentY += font.bodyLine;
          });
          contentY += spacing.paragraphMarginBottom;
          lastElementType = 'quote';
          continue;
        }
        
        // ===== REGULAR PARAGRAPH - margin-bottom: 12px =====
        const height = renderBoldText(line, contentX, textMaxW, textColor, font.body, font.bodyLine, contentY);
        contentY += height + spacing.paragraphMarginBottom;
        lastElementType = 'paragraph';
      }
      
      // AI images at end
      if (!isUser && images.length) {
        for (const imgData of images) {
          if (imgData?.base64) {
            let iw = Math.min(imgData.width || 300, textMaxW);
            let ih = (imgData.height || 200) * (iw / (imgData.width || 300));
            if (ih > 220) { ih = 220; iw = (imgData.width || 300) * (ih / (imgData.height || 200)); }
            contentY += 4;
            try {
              pdf.addImage(imgData.base64, 'JPEG', contentX, contentY, iw, ih);
              contentY += ih + spacing.paragraphMarginBottom;
            } catch(e) {
              pdf.setFont('helvetica', 'italic');
              pdf.setFontSize(font.body);
              pdf.setTextColor(...colors.meta);
              pdf.text('[Image]', contentX, contentY);
              contentY += font.bodyLine;
            }
          }
        }
      }
      
      // Move y past bubble + 24px gap (margin-bottom: 24px)
      y = bubbleY + bubbleH + spacing.bubbleGap;
    }
    
    // ========== PAGE NUMBERS ==========
    const totalPages = pdf.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      pdf.setPage(i);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(font.meta);
      pdf.setTextColor(...colors.meta);
      pdf.text(`${i}`, pageWidth / 2, pageHeight - 24);
    }
    
    // Save PDF
    const filename = safeTitle.replace(/[^a-z0-9]/gi, '_').substring(0, 50) + '.pdf';
    pdf.save(filename);
    console.log('PDF saved:', filename);
    
  } catch (error) {
    console.error('PDF generation error:', error);
    alert('Error generating PDF: ' + error.message);
  }
}

async function generatePDF(data) {
  let attempts = 0;
  while (!jsPDFInstance && attempts < 30) {
    await wait(100);
    attempts++;
  }
  
  if (!jsPDFInstance) {
    alert('PDF library loading. Please try again.');
    return;
  }
  
  if ((isGemini || isClaude) && jsPDFLib) {
    generatePDFInContentScript(data);
  } else {
    window.postMessage({ type: 'GENERATE_PDF', data }, '*');
  }
}

// ============================================
// EXPORT FUNCTIONS
// ============================================

function downloadMarkdown(data) {
  // Create a properly formatted Markdown document
  let md = '';
  
  // Document title with proper heading
  md += `# ${data.title}\n\n`;
  
  // Metadata section
  md += `> **Exported:** ${data.date}  \n`;
  md += `> **Messages:** ${data.stats.total} (${data.stats.user || 0} from user, ${data.stats.assistant || 0} from assistant)  \n`;
  md += `> **Word Count:** ${data.stats.words}\n\n`;
  
  // Separator
  md += `---\n\n`;
  
  // Process each message
  data.messages.forEach((msg, idx) => {
    const roleEmoji = msg.role === 'user' ? '👤' : '🤖';
    const roleLabel = msg.role === 'user' ? 'You' : 'Assistant';
    
    // Message header
    md += `## ${roleEmoji} ${roleLabel}\n\n`;
    
    // Process message content
    let text = msg.text || '';
    
    // Handle code blocks - replace placeholders with proper markdown code blocks
    if (msg.codeBlocks?.length) {
      msg.codeBlocks.forEach(block => {
        text = text.replace(block.id, `\n\`\`\`${block.language}\n${block.code}\n\`\`\`\n`);
      });
    }
    
    // Handle images - add markdown image syntax
    if (msg.images?.length) {
      msg.images.forEach((img, imgIdx) => {
        const alt = img.alt || `Image ${imgIdx + 1}`;
        text += `\n\n![${alt}](${img.src})\n`;
      });
    }
    
    // Format the text content
    const lines = text.split('\n');
    const formattedLines = [];
    
    for (const line of lines) {
      let formattedLine = line;
      
      // Preserve existing headers
      if (formattedLine.match(/^#{1,6}\s+/)) {
        formattedLines.push(formattedLine);
        continue;
      }
      
      // Preserve code blocks
      if (formattedLine.match(/^```/) || formattedLine.match(/^\s{4,}/)) {
        formattedLines.push(formattedLine);
        continue;
      }
      
      // Normalize bullet points to markdown format
      formattedLine = formattedLine.replace(/^[\u2022\u2023\u25E6\u2043\u2219\u25AA\u25CF\u25CB\u25B6\u25BA•●○◦◆◇▪▫★☆→➤➔►]\s*/g, '- ');
      
      // Ensure numbered lists have proper formatting
      formattedLine = formattedLine.replace(/^(\d+)\)\s+/, '$1. ');
      
      formattedLines.push(formattedLine);
    }
    
    md += formattedLines.join('\n');
    md += '\n\n';
    
    // Add separator between messages (except after last one)
    if (idx < data.messages.length - 1) {
      md += `---\n\n`;
    }
  });
  
  // Footer
  md += `\n---\n\n`;
  md += `*Exported using AI Chat Exporter*\n`;
  
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${data.title.replace(/[^a-z0-9]/gi, '_').substring(0, 50)}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function downloadHTML(data) {
  // Create a professionally formatted HTML document
  const escapeHTML = (str) => {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };
  
  // Process message text to HTML with proper formatting
  const formatMessageHTML = (msg) => {
    let text = msg.text || '';
    
    // Handle code blocks
    if (msg.codeBlocks?.length) {
      msg.codeBlocks.forEach(block => {
        const escapedCode = escapeHTML(block.code);
        text = text.replace(block.id, 
          `<div class="code-block"><div class="code-header">${escapeHTML(block.language.toUpperCase())}</div><pre><code>${escapedCode}</code></pre></div>`
        );
      });
    }
    
    // Handle images
    let imagesHTML = '';
    if (msg.images?.length) {
      msg.images.forEach((img, imgIdx) => {
        const alt = escapeHTML(img.alt || `Image ${imgIdx + 1}`);
        imagesHTML += `<figure class="message-image"><img src="${escapeHTML(img.src)}" alt="${alt}" loading="lazy"><figcaption>${alt}</figcaption></figure>`;
      });
    }
    
    // Split into lines and process
    const lines = text.split('\n');
    let html = '';
    let inList = false;
    let listType = '';
    
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      
      // Empty line
      if (!line.trim()) {
        if (inList) {
          html += listType === 'ul' ? '</ul>' : '</ol>';
          inList = false;
        }
        html += '<br>';
        continue;
      }
      
      // Headers
      const h1Match = line.match(/^#{1,2}\s+(.+)$/);
      if (h1Match) {
        if (inList) { html += listType === 'ul' ? '</ul>' : '</ol>'; inList = false; }
        html += `<h3>${escapeHTML(h1Match[1])}</h3>`;
        continue;
      }
      
      const h3Match = line.match(/^#{3,}\s+(.+)$/);
      if (h3Match) {
        if (inList) { html += listType === 'ul' ? '</ul>' : '</ol>'; inList = false; }
        html += `<h4>${escapeHTML(h3Match[1])}</h4>`;
        continue;
      }
      
      // Bullet points
      const bulletMatch = line.match(/^[-*\u2022\u25CF\u25CB•●○]\s*(.+)$/);
      if (bulletMatch) {
        if (!inList || listType !== 'ul') {
          if (inList) html += listType === 'ul' ? '</ul>' : '</ol>';
          html += '<ul>';
          inList = true;
          listType = 'ul';
        }
        html += `<li>${formatInlineHTML(escapeHTML(bulletMatch[1]))}</li>`;
        continue;
      }
      
      // Numbered list
      const numMatch = line.match(/^(\d+)[.)]\s*(.+)$/);
      if (numMatch) {
        if (!inList || listType !== 'ol') {
          if (inList) html += listType === 'ul' ? '</ul>' : '</ol>';
          html += '<ol>';
          inList = true;
          listType = 'ol';
        }
        html += `<li>${formatInlineHTML(escapeHTML(numMatch[2]))}</li>`;
        continue;
      }
      
      // Regular paragraph
      if (inList) {
        html += listType === 'ul' ? '</ul>' : '</ol>';
        inList = false;
      }
      
      // Check if line already contains HTML (from code block replacement)
      if (line.includes('<div class="code-block">')) {
        html += line;
      } else {
        html += `<p>${formatInlineHTML(escapeHTML(line))}</p>`;
      }
    }
    
    if (inList) {
      html += listType === 'ul' ? '</ul>' : '</ol>';
    }
    
    // Add images at the end
    html += imagesHTML;
    
    return html;
  };
  
  // Format inline elements (bold, italic, code)
  const formatInlineHTML = (text) => {
    return text
      // Bold: **text** or __text__
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.+?)__/g, '<strong>$1</strong>')
      // Italic: *text* or _text_
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/_([^_]+)_/g, '<em>$1</em>')
      // Inline code: `code`
      .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
  };
  
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHTML(data.title)}</title>
  <style>
    * {
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      line-height: 1.6;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 20px;
      background: #fafafa;
      color: #333;
    }
    
    /* Document Header */
    .document-header {
      text-align: center;
      margin-bottom: 40px;
      padding-bottom: 30px;
      border-bottom: 2px solid #e0e0e0;
    }
    
    .document-header h1 {
      font-size: 28px;
      font-weight: 600;
      color: #1a1a1a;
      margin: 0 0 15px 0;
    }
    
    .metadata {
      display: flex;
      justify-content: center;
      flex-wrap: wrap;
      gap: 20px;
      font-size: 14px;
      color: #666;
    }
    
    .metadata-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    
    .metadata-item strong {
      color: #444;
    }
    
    /* Messages */
    .message {
      margin-bottom: 30px;
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.06);
      overflow: hidden;
    }
    
    .message-header {
      padding: 12px 20px;
      font-weight: 600;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .message.user .message-header {
      background: linear-gradient(135deg, #10a37f, #0d8a6a);
      color: white;
    }
    
    .message.assistant .message-header {
      background: linear-gradient(135deg, #8b5cf6, #7c3aed);
      color: white;
    }
    
    .message-content {
      padding: 20px;
    }
    
    .message-content p {
      margin: 0 0 12px 0;
    }
    
    .message-content p:last-child {
      margin-bottom: 0;
    }
    
    .message-content h3 {
      font-size: 18px;
      font-weight: 600;
      color: #1a1a1a;
      margin: 20px 0 10px 0;
      padding-bottom: 5px;
      border-bottom: 1px solid #eee;
    }
    
    .message-content h3:first-child {
      margin-top: 0;
    }
    
    .message-content h4 {
      font-size: 16px;
      font-weight: 600;
      color: #333;
      margin: 15px 0 8px 0;
    }
    
    /* Lists */
    .message-content ul,
    .message-content ol {
      margin: 12px 0;
      padding-left: 24px;
    }
    
    .message-content li {
      margin: 6px 0;
    }
    
    /* Code */
    .code-block {
      margin: 15px 0;
      border-radius: 8px;
      overflow: hidden;
      background: #1e1e1e;
    }
    
    .code-header {
      background: #333;
      color: #aaa;
      padding: 8px 12px;
      font-size: 12px;
      font-family: 'SF Mono', Monaco, 'Courier New', monospace;
    }
    
    .code-block pre {
      margin: 0;
      padding: 15px;
      overflow-x: auto;
    }
    
    .code-block code {
      font-family: 'SF Mono', Monaco, 'Courier New', monospace;
      font-size: 13px;
      color: #d4d4d4;
      line-height: 1.5;
    }
    
    .inline-code {
      background: #f0f0f0;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'SF Mono', Monaco, 'Courier New', monospace;
      font-size: 0.9em;
      color: #c7254e;
    }
    
    /* Images */
    .message-image {
      margin: 15px 0;
      text-align: center;
    }
    
    .message-image img {
      max-width: 100%;
      height: auto;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    
    .message-image figcaption {
      margin-top: 8px;
      font-size: 12px;
      color: #666;
      font-style: italic;
    }
    
    /* Footer */
    .document-footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e0e0e0;
      text-align: center;
      font-size: 12px;
      color: #999;
    }
    
    /* Print styles */
    @media print {
      body {
        background: white;
        padding: 20px;
      }
      
      .message {
        box-shadow: none;
        border: 1px solid #ddd;
        break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="document-header">
    <h1>${escapeHTML(data.title)}</h1>
    <div class="metadata">
      <div class="metadata-item">
        <span>📅</span>
        <span>${escapeHTML(data.date)}</span>
      </div>
      <div class="metadata-item">
        <span>💬</span>
        <strong>${data.stats.total}</strong>
        <span>messages</span>
      </div>
      <div class="metadata-item">
        <span>📝</span>
        <strong>${data.stats.words}</strong>
        <span>words</span>
      </div>
    </div>
  </div>
  
  <div class="messages">
${data.messages.map(msg => `    <div class="message ${msg.role}">
      <div class="message-header">
        <span>${msg.role === 'user' ? '👤' : '🤖'}</span>
        <span>${msg.role === 'user' ? 'You' : 'Assistant'}</span>
      </div>
      <div class="message-content">
        ${formatMessageHTML(msg)}
      </div>
    </div>`).join('\n')}
  </div>
  
  <div class="document-footer">
    Exported using AI Chat Exporter
  </div>
</body>
</html>`;
  
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${data.title.replace(/[^a-z0-9]/gi, '_').substring(0, 50)}.html`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ============================================
// UI - FLOATING MENU
// ============================================

function createFloatingMenu() {
  if (document.getElementById('chat-exporter-menu')) return;
  
  const container = document.createElement('div');
  container.id = 'chat-exporter-menu';
  Object.assign(container.style, {
    position: 'fixed', bottom: '24px', right: '24px', zIndex: '999999',
    display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-end'
  });
  
  const menu = document.createElement('div');
  Object.assign(menu.style, {
    display: 'none', flexDirection: 'column', gap: '8px',
    background: '#2a2a2a', padding: '14px', borderRadius: '14px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)', border: '1px solid #3a3a3a',
    backdropFilter: 'blur(10px)'
  });
  
  const mainBtn = document.createElement('button');
  mainBtn.innerHTML = '<span style="margin-right:6px;">📄</span>Export';
  Object.assign(mainBtn.style, {
    padding: '11px 18px', borderRadius: '10px', border: '1px solid #3a3a3a',
    background: '#2a2a2a', color: '#e5e5e5',
    cursor: 'pointer', fontWeight: '500', fontSize: '13px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.3)', transition: 'all 0.2s',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
  });
  mainBtn.onmouseover = () => {
    mainBtn.style.background = '#333';
    mainBtn.style.transform = 'translateY(-2px)';
    mainBtn.style.boxShadow = '0 6px 20px rgba(0,0,0,0.4)';
  };
  mainBtn.onmouseout = () => {
    mainBtn.style.background = '#2a2a2a';
    mainBtn.style.transform = 'translateY(0)';
    mainBtn.style.boxShadow = '0 4px 16px rgba(0,0,0,0.3)';
  };
  
  const createItem = (emoji, text, onClick) => {
    const btn = document.createElement('button');
    btn.innerHTML = `<span style="margin-right:8px;">${emoji}</span>${text}`;
    Object.assign(btn.style, {
      padding: '10px 14px', borderRadius: '8px', border: '1px solid #3a3a3a',
      background: '#222', color: '#e5e5e5', cursor: 'pointer', fontSize: '13px',
      textAlign: 'left', transition: 'all 0.2s', display: 'flex', alignItems: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontWeight: '400', minWidth: '140px'
    });
    btn.onmouseover = () => {
      btn.style.background = '#333';
      btn.style.borderColor = '#4a4a4a';
    };
    btn.onmouseout = () => {
      btn.style.background = '#222';
      btn.style.borderColor = '#3a3a3a';
    };
    btn.onclick = async () => {
      mainBtn.innerHTML = '<span style="margin-right:6px;">⏳</span>Processing...';
      mainBtn.disabled = true;
      mainBtn.style.opacity = '0.6';
      try {
        const data = await extractConversation();
        if (data.messages.length === 0) {
          alert('No messages found.');
        } else {
          await onClick(data);
        }
      } catch (e) {
        alert('Export failed: ' + e.message);
      }
      mainBtn.innerHTML = '<span style="margin-right:6px;">📄</span>Export';
      mainBtn.disabled = false;
      mainBtn.style.opacity = '1';
      menu.style.display = 'none';
    };
    return btn;
  };
  
  menu.appendChild(createItem('📄', 'PDF', generatePDF));
  menu.appendChild(createItem('📝', 'Markdown', downloadMarkdown));
  menu.appendChild(createItem('🌐', 'HTML', downloadHTML));
  
  mainBtn.onclick = () => {
    const isVisible = menu.style.display === 'flex';
    menu.style.display = isVisible ? 'none' : 'flex';
    if (!isVisible) {
      menu.style.animation = 'slideUp 0.2s ease-out';
    }
  };
  
  // Add animation styles
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideUp {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);
  
  container.appendChild(menu);
  container.appendChild(mainBtn);
  
  (document.querySelector('main') || document.body).appendChild(container);
}

// Initialize
const initMenu = () => {
  if (!document.getElementById('chat-exporter-menu')) createFloatingMenu();
};

new MutationObserver(initMenu).observe(document.body, { childList: true, subtree: true });
setTimeout(initMenu, 500);
setTimeout(initMenu, 2000);
setInterval(initMenu, 3000);

// ============================================
// CONTEXT MENU LISTENER
// ============================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'exportConversation') {
    (async () => {
      try {
        const data = await extractConversation();
        if (!data.messages.length) {
          alert('No conversation found.');
          sendResponse({ success: false });
          return;
        }
        if (isGemini || isClaude) {
          generatePDFInContentScript(data);
        } else {
          window.postMessage({ type: 'GENERATE_PDF', data }, '*');
        }
        sendResponse({ success: true });
      } catch (e) {
        alert('Export failed: ' + e.message);
        sendResponse({ success: false });
      }
    })();
    return true;
  }
});

console.log('✅ ChatArchive loaded for:', isGemini ? 'Gemini' : isClaude ? 'Claude' : isChatGPT ? 'ChatGPT' : 'Other');
