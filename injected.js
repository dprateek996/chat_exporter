(function() {
  const checkJsPDF = setInterval(() => {
    if (window.jspdf && window.jspdf.jsPDF) {
      clearInterval(checkJsPDF);
      window.postMessage({ type: 'JSPDF_READY', jsPDFAvailable: true }, '*');
    }
  }, 100);

  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.data.type !== 'GENERATE_PDF') return;

    const data = event.data.data;
    const { jsPDF } = window.jspdf || window;

    if (!jsPDF) {
      alert("jsPDF not available.");
      return;
    }

    try {
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'pt',
        format: 'a4'
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 40;
      const avatarSize = 30;
      const bubblePadding = 15;
      const maxBubbleWidth = 400; // increased for better wrapping, aligns with Gemini
      const contentWidth = maxBubbleWidth - (bubblePadding * 2);

      let y = margin;

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(16);
      pdf.setTextColor(0);
      pdf.text(data.title, margin, y);
      y += 20;

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(100);
      pdf.text(`${data.date} • ${data.stats.total} messages • ${data.stats.words} words`, margin, y);
      y += 8;

      pdf.setDrawColor(220);
      pdf.line(margin, y, pageWidth - margin, y);
      y += 15;

      let isFirstMessage = true;
      for (const msg of data.messages) {
        const isUser = msg.role === 'user';
        const bubbleColor = isUser ? '#dcf8c6' : '#f0f0f0';
        const textColor = '#000000';

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(10);
        
        let displayText = msg.text;
        if (msg.codeBlocks && msg.codeBlocks.length > 0) {
          msg.codeBlocks.forEach(block => {
            displayText = displayText.replace(block.id, `\n[${block.language.toUpperCase()}]\n${block.code}\n[/${block.language.toUpperCase()}]\n`);
          });
        }
        
        const maxTextWidth = contentWidth - 30;
        const lines = pdf.splitTextToSize(displayText, maxTextWidth);
        const lineHeight = 12;
        const textBlockHeight = lines.length * lineHeight + 15;
        
        let totalHeight = textBlockHeight + (bubblePadding * 2) + 10;
        if (msg.images && msg.images.length > 0) {
            for (const img of msg.images) {
                if (img.type === 'svg') {
                    const aspectRatio = img.height / img.width;
                    const displayWidth = Math.min(img.width, contentWidth);
                    const displayHeight = displayWidth * aspectRatio;
                    totalHeight += displayHeight + 10;
                } else {
                    totalHeight += 170;
                }
            }
        }

        if (!isFirstMessage && y + totalHeight + avatarSize > pageHeight - margin) {
          pdf.addPage();
          y = margin;
        }
        
        isFirstMessage = false;

        let avatarX, bubbleX;
        
        if (isUser) {
          bubbleX = pageWidth - margin - maxBubbleWidth;
          avatarX = pageWidth - margin - (avatarSize / 2);
        } else {
          avatarX = margin + (avatarSize / 2);
          bubbleX = margin + avatarSize + 10;
        }


        const avatarY = y;
        pdf.setFillColor(isUser ? '#10a37f' : '#8b5cf6');
        pdf.circle(avatarX, avatarY + (avatarSize / 2), avatarSize / 2, 'F');
        
        pdf.setTextColor(255);
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'bold');
        const initial = isUser ? 'U' : 'AI';
        const textWidth = pdf.getTextWidth(initial);
        pdf.text(initial, avatarX - (textWidth / 2), avatarY + (avatarSize / 2) + 3);

        pdf.setFillColor(bubbleColor);
        pdf.setDrawColor(bubbleColor);
        pdf.roundedRect(bubbleX, y, maxBubbleWidth, totalHeight, 8, 8, 'F');

        let currentY = y + bubblePadding + 10;
        let inCodeBlock = false;
        
        for (const line of lines) {
          const isCodeStart = line.match(/^\[([A-Z]+)\]$/);
          const isCodeEnd = line.match(/^\[\/([A-Z]+)\]$/);
          
          if (isCodeStart) {
            inCodeBlock = true;
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(8);
            pdf.setTextColor(100);
            pdf.text(line, bubbleX + bubblePadding, currentY);
            currentY += lineHeight;
            continue;
          }
          
          if (isCodeEnd) {
            inCodeBlock = false;
            currentY += 5;
            continue;
          }
          
          if (inCodeBlock) {
            pdf.setFont('courier', 'normal');
            pdf.setFontSize(9);
            pdf.setFillColor(isUser ? '#c8e6c9' : '#e8e8e8');
            pdf.rect(bubbleX + bubblePadding - 5, currentY - 10, contentWidth + 10, lineHeight, 'F');
            pdf.setTextColor(textColor);
            pdf.text(line, bubbleX + bubblePadding, currentY);
          } else {
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(8.5);
            pdf.setTextColor(textColor);
            pdf.text(line, bubbleX + bubblePadding, currentY);
          }
          currentY += lineHeight;
        }

        if (msg.images && msg.images.length > 0) {
            let imgY = currentY + 10;
            for (const img of msg.images) {
                try {
                    if (img.type === 'svg' || img.src.startsWith('data:image/svg')) {
                        const aspectRatio = img.height / img.width;
                        const displayWidth = Math.min(img.width, contentWidth);
                        const displayHeight = displayWidth * aspectRatio;
                        
                        if (imgY + displayHeight > pageHeight - margin) {
                            pdf.addPage();
                            y = margin;
                            imgY = margin;
                        }
                        
                        pdf.addImage(img.src, 'SVG', bubbleX + bubblePadding, imgY, displayWidth, displayHeight);
                        imgY += displayHeight + 10;
                    } else {
                        try {
                            pdf.addImage(img.src, 'JPEG', bubbleX + bubblePadding, imgY, 200, 150);
                            imgY += 160;
                        } catch (e) {
                            pdf.setTextColor(0, 0, 255);
                            pdf.textWithLink('[Image Attachment]', bubbleX + bubblePadding, imgY, { url: img.src });
                            imgY += 20;
                        }
                    }
                } catch (e) {
                    console.warn("Image/SVG embed failed", e);
                }
            }
        }

        y += totalHeight + 20;
      }

      const filename = data.title.replace(/[^a-z0-9]/gi, '_').substring(0, 50) + ".pdf";
      pdf.save(filename);
      window.postMessage({ type: 'PDF_GENERATED' }, '*');

    } catch (error) {
      console.error("PDF Gen Error:", error);
      alert("Error: " + error.message);
    }
  });
})();
