(function() {
  const checkJsPDF = setInterval(() => {
    if (window.jspdf && window.jspdf.jsPDF) {
      clearInterval(checkJsPDF);
      window.postMessage({ type: 'JSPDF_READY', jsPDFAvailable: true }, '*');
    }
  }, 100);

  /**
   * Fetch blob URL from page context (blobs are context-specific)
   */
  async function fetchBlobAsBase64(blobUrl) {
    try {
      const response = await fetch(blobUrl);
      if (!response.ok) return null;
      const blob = await response.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      console.warn('Blob fetch failed:', e);
      return null;
    }
  }

  /**
   * Convert image element to base64 in page context
   */
  function imageElementToBase64(img) {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const w = img.naturalWidth || img.width || 300;
      const h = img.naturalHeight || img.height || 200;
      const maxDim = 800;
      let finalW = w, finalH = h;
      if (w > maxDim || h > maxDim) {
        const ratio = Math.min(maxDim / w, maxDim / h);
        finalW = Math.floor(w * ratio);
        finalH = Math.floor(h * ratio);
      }
      canvas.width = finalW;
      canvas.height = finalH;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, finalW, finalH);
      ctx.drawImage(img, 0, 0, finalW, finalH);
      return canvas.toDataURL('image/jpeg', 0.85);
    } catch (e) {
      console.warn('Canvas conversion failed:', e);
      return null;
    }
  }

  // Handle image fetch requests from content script
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    
    if (event.data.type === 'FETCH_BLOB_IMAGE') {
      const { blobUrl, requestId } = event.data;
      let base64 = null;
      
      // Try fetching the blob
      if (blobUrl.startsWith('blob:')) {
        base64 = await fetchBlobAsBase64(blobUrl);
      }
      
      // If that fails, try finding and capturing the img element
      if (!base64) {
        const img = document.querySelector(`img[src="${blobUrl}"]`);
        if (img && img.complete && img.naturalWidth > 0) {
          base64 = imageElementToBase64(img);
        }
      }
      
      window.postMessage({ 
        type: 'BLOB_IMAGE_RESULT', 
        requestId, 
        base64 
      }, '*');
      return;
    }
  });

  /**
   * Sanitize text for PDF output - jsPDF only supports basic Latin characters
   */
  function sanitizeForPDF(text) {
    if (!text) return '';
    
    let cleaned = text;
    
    // Remove zero-width and invisible characters
    cleaned = cleaned
      .replace(/[\u200B-\u200D\uFEFF\u00AD\u200E\u200F]/g, '')
      .replace(/[\u2028\u2029]/g, '\n');
    
    // Remove private use area characters (icons/symbols)
    cleaned = cleaned.replace(/[\uE000-\uF8FF]/g, '');
    
    // Remove garbage icon font patterns like Ø=Ý
    cleaned = cleaned
      .replace(/Ø[=<>]?[A-Za-zÞþßÜÄŸ€Ý]*/g, '')
      .replace(/[֍þãÜÀŸ¢ßØÞ€Ý]/g, '')
      .replace(/[\uF000-\uFFFF]/g, '');
    
    // Normalize Unicode to ASCII
    const unicodeToAscii = {
      '\u2018': "'", '\u2019': "'", '\u201A': "'", '\u201B': "'",
      '\u201C': '"', '\u201D': '"', '\u201E': '"', '\u201F': '"',
      '\u2039': '<', '\u203A': '>',
      '\u00AB': '"', '\u00BB': '"',
      '\u2013': '-', '\u2014': '-', '\u2015': '-', '\u2212': '-',
      '\u00A0': ' ', '\u2002': ' ', '\u2003': ' ', '\u2009': ' ',
      '\u2026': '...',
      '\u2192': '->', '\u2190': '<-', '\u2194': '<->',
      '\u21D2': '=>', '\u21D0': '<=',
      '\u27A4': '->', '\u2794': '->', '\u279C': '->',
      '\u00D7': 'x', '\u00F7': '/',
      '\u2260': '!=', '\u2264': '<=', '\u2265': '>=',
      '\u2713': '[v]', '\u2714': '[v]', '\u2715': '[x]', '\u2716': '[x]',
      '\u00A9': '(c)', '\u00AE': '(R)', '\u2122': '(TM)',
    };
    
    for (const [unicode, ascii] of Object.entries(unicodeToAscii)) {
      cleaned = cleaned.replace(new RegExp(unicode, 'g'), ascii);
    }
    
    // Normalize bullet points to dash
    const bulletChars = /[\u2022\u2023\u25E6\u2043\u2219\u25AA\u25CF\u25CB\u25B6\u25BA\u25C6\u25C7\u2605\u2606\u2666\u27A2●○◦◆◇▪▫★☆→➤►]/g;
    cleaned = cleaned.replace(bulletChars, '-');
    
    // Replace accented characters with base letters
    cleaned = cleaned
      .replace(/[\u00e0\u00e1\u00e2\u00e3\u00e4\u00e5]/gi, 'a')
      .replace(/[\u00e8\u00e9\u00ea\u00eb]/gi, 'e')
      .replace(/[\u00ec\u00ed\u00ee\u00ef]/gi, 'i')
      .replace(/[\u00f2\u00f3\u00f4\u00f5\u00f6]/gi, 'o')
      .replace(/[\u00f9\u00fa\u00fb\u00fc]/gi, 'u')
      .replace(/[\u00f1]/gi, 'n')
      .replace(/[\u00e7]/gi, 'c')
      .replace(/[\u00df]/g, 'ss')
      .replace(/[\u00e6]/gi, 'ae')
      .replace(/[\u0153]/gi, 'oe');
    
    // Remove any remaining non-printable or non-ASCII
    cleaned = cleaned.replace(/[^\x20-\x7E\n\t]/g, '');
    
    return cleaned.replace(/  +/g, ' ').trim();
  }

  // ============================================
  // PDF RENDERER - ROBUST TEXT-MARKER SYSTEM
  // Uses ## for headers, • for bullets, [CODE:] for code
  // With strict width calculation to prevent cutoff
  // ============================================
  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.data.type !== 'GENERATE_PDF') return;

    const data = event.data.data;
    const { jsPDF } = window.jspdf || window;

    if (!jsPDF) { 
      alert("jsPDF library missing"); 
      return; 
    }

    try {
      const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
      const pageWidth = 595.28;
      const pageHeight = 841.89;
      const margin = 36;
      let y = margin;
      
      // THEME COLORS
      const COLORS = {
        userBg: [243, 244, 246],   // #F3F4F6
        aiBg: [255, 255, 255],     // White
        border: [229, 231, 235],   // #E5E7EB
        text: [31, 41, 55],        // Dark grey
        accent: [0, 0, 0]          // Black for headers
      };

      const checkPage = (h) => {
        if (y + h > pageHeight - margin) {
          pdf.addPage();
          y = margin;
          return true;
        }
        return false;
      };

      // --- HEADER ---
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(16);
      pdf.setTextColor(0, 0, 0);
      pdf.text(sanitizeForPDF(data.title || 'Export').substring(0, 50), margin, y);
      y += 20;
      
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      pdf.setTextColor(100, 100, 100);
      pdf.text(`${data.date} - ${data.messages.length} Messages`, margin, y);
      y += 30;
      
      pdf.setDrawColor(200, 200, 200);
      pdf.line(margin, y, pageWidth - margin, y);
      y += 30;

      // --- MESSAGE LOOP ---
      for (const msg of data.messages) {
        try {
          if (!msg.text && (!msg.images || msg.images.length === 0)) continue;

          const isUser = msg.role === 'user';
          const bubbleWidth = 430;
          const x = isUser ? (pageWidth - margin - bubbleWidth) : margin;
          const padding = 20;
          
          // SAFETY BUFFER: Narrower than the box to prevent cutoff
          const textWidth = bubbleWidth - 50;

          // 1. PROCESS TEXT - Inject code blocks
          let rawText = sanitizeForPDF(msg.text || '').replace(/\*\*/g, '');
          if (msg.codeBlocks && msg.codeBlocks.length > 0) {
            msg.codeBlocks.forEach(b => {
              const codeContent = sanitizeForPDF(b.code || '');
              rawText = rawText.replace(b.id, `\n[CODE: ${b.language}]\n${codeContent}\n[ENDCODE]\n`);
            });
          }

          // 2. CALCULATE LINES (Font-Aware)
          pdf.setFontSize(11);
          const finalLines = [];
          const lines = rawText.split('\n');

          for (let line of lines) {
            line = line.trimEnd();
            if (!line) continue;

            // DETECT MARKERS
            if (line.startsWith('## ')) {
              // HEADER DETECTED
              pdf.setFont('helvetica', 'bold');
              const clean = line.replace('## ', '').toUpperCase();
              const split = pdf.splitTextToSize(clean, textWidth);
              split.forEach(s => finalLines.push({ text: s, type: 'header' }));
            }
            else if (line.startsWith('• ')) {
              // BULLET DETECTED
              pdf.setFont('helvetica', 'normal');
              const split = pdf.splitTextToSize(line, textWidth);
              split.forEach(s => finalLines.push({ text: s, type: 'bullet' }));
            }
            else if (line.startsWith('[CODE:')) {
              finalLines.push({ text: line, type: 'code_meta' });
            }
            else if (line.startsWith('[ENDCODE]')) {
              // skip
            }
            else if (line.startsWith('[TABLE]:') || line.startsWith('|')) {
              // TABLE DATA - render as monospace
              pdf.setFont('courier', 'normal');
              const split = pdf.splitTextToSize(line, textWidth);
              split.forEach(s => finalLines.push({ text: s, type: 'table' }));
            }
            else {
              // NORMAL TEXT
              pdf.setFont('helvetica', 'normal');
              const split = pdf.splitTextToSize(line, textWidth);
              split.forEach(s => finalLines.push({ text: s, type: 'text' }));
            }
          }

          // 3. CALC HEIGHT
          const lineHeight = 15;
          const imageCount = (msg.images && msg.images.length) || 0;
          const contentHeight = (finalLines.length * lineHeight) + (imageCount * 180) + (padding * 2);
          checkPage(contentHeight + 20);

          // 4. DRAW BUBBLE
          pdf.setFillColor(...(isUser ? COLORS.userBg : COLORS.aiBg));
          pdf.setDrawColor(...COLORS.border);
          pdf.roundedRect(x, y, bubbleWidth, contentHeight, 8, 8, 'FD');

          // 5. RENDER TEXT
          let cy = y + padding + 5;
          const cx = x + padding;
          pdf.setTextColor(...COLORS.text);

          for (const l of finalLines) {
            if (l.type === 'header') {
              pdf.setFont('helvetica', 'bold');
              pdf.setFontSize(11);
              pdf.text(l.text, cx, cy);
              cy += lineHeight + 5;
            }
            else if (l.type === 'bullet') {
              pdf.setFont('helvetica', 'normal');
              pdf.setFontSize(11);
              pdf.text(l.text, cx, cy);
              cy += lineHeight;
            }
            else if (l.type === 'code_meta') {
              pdf.setFont('courier', 'bold');
              pdf.setFontSize(9);
              pdf.setTextColor(100, 100, 100);
              pdf.text(l.text.replace('[', '').replace(']', ''), cx, cy);
              pdf.setTextColor(...COLORS.text);
              cy += lineHeight;
            }
            else if (l.type === 'table') {
              pdf.setFont('courier', 'normal');
              pdf.setFontSize(9);
              pdf.text(l.text, cx, cy);
              cy += lineHeight - 2;
            }
            else {
              pdf.setFont('helvetica', 'normal');
              pdf.setFontSize(11);
              pdf.text(l.text, cx, cy);
              cy += lineHeight;
            }
          }

          // 6. RENDER IMAGES
          if (msg.images && msg.images.length > 0) {
            for (const img of msg.images) {
              if (cy + 160 > pageHeight - margin) {
                pdf.addPage();
                cy = margin;
              }
              try {
                const imgSrc = img.base64 || img.src;
                if (imgSrc) {
                  pdf.addImage(imgSrc, 'JPEG', cx, cy + 5, 200, 150);
                  cy += 160;
                }
              } catch (e) {
                pdf.setFontSize(9);
                pdf.setTextColor(0, 0, 255);
                pdf.text('[Image]', cx, cy + 15);
                pdf.setTextColor(...COLORS.text);
                cy += 25;
              }
            }
          }

          y += contentHeight + 15;
          
        } catch (msgErr) {
          console.error("Error rendering message:", msgErr);
          // Continue to next message
        }
      }

      // Save PDF
      const filename = sanitizeForPDF(data.title || 'Chat_Export').replace(/[^a-z0-9]/gi, '_').substring(0, 30) + '.pdf';
      pdf.save(filename);
      window.postMessage({ type: 'PDF_GENERATED' }, '*');

    } catch (error) {
      console.error("PDF Gen Error:", error);
      alert("Error generating PDF: " + error.message);
    }
  });
})();
