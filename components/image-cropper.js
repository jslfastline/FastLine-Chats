// ════════════════════════════════════════════════════
//  FastLine Chats — components/image-cropper.js
//  Interactive avatar cropper: shape, zoom, pan, output size
// ════════════════════════════════════════════════════

const SHAPES = {
  circle:   { label: 'Circle',   ratio: 1,    round: true },
  square:   { label: 'Square',   ratio: 1,    round: false },
  wide:     { label: 'Wide',     ratio: 16/9, round: false },
  portrait: { label: 'Portrait', ratio: 3/4,  round: false },
};

const SIZES = {
  small:  256,
  medium: 512,
  large:  1024,
};

/**
 * Open cropper modal for an image file.
 * @returns {Promise<Blob|null>} Cropped image blob, or null if cancelled.
 */
export function openImageCropper(file, options = {}) {
  return new Promise((resolve) => {
    const defaultShape = options.shape || 'circle';
    const defaultSize  = options.size  || 'medium';

    const overlay = document.createElement('div');
    overlay.className = 'cropper-overlay';
    overlay.innerHTML = `
      <div class="cropper-modal">
        <div class="cropper-header">
          <h3><i class="fas fa-crop-alt"></i> Adjust Photo</h3>
          <button type="button" class="icon-btn cropper-close" aria-label="Close"><i class="fas fa-times"></i></button>
        </div>
        <div class="cropper-preview-wrap">
          <canvas class="cropper-canvas" width="320" height="320"></canvas>
          <div class="cropper-frame"></div>
        </div>
        <div class="cropper-controls">
          <label class="cropper-label">Shape</label>
          <div class="cropper-shape-btns">
            ${Object.entries(SHAPES).map(([k, v]) =>
              `<button type="button" class="cropper-shape-btn${k === defaultShape ? ' active' : ''}" data-shape="${k}">${v.label}</button>`
            ).join('')}
          </div>
          <label class="cropper-label">Output Size</label>
          <div class="cropper-size-btns">
            ${Object.entries(SIZES).map(([k, v]) =>
              `<button type="button" class="cropper-size-btn${k === defaultSize ? ' active' : ''}" data-size="${k}">${k} (${v}px)</button>`
            ).join('')}
          </div>
          <label class="cropper-label">Zoom</label>
          <input type="range" class="cropper-zoom" min="1" max="3" step="0.01" value="1" />
          <p class="cropper-hint">Drag the image to reposition · Pinch or use zoom slider</p>
        </div>
        <div class="cropper-actions">
          <button type="button" class="btn-secondary cropper-cancel">Cancel</button>
          <button type="button" class="btn-primary cropper-apply"><i class="fas fa-check"></i> Apply</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const canvas  = overlay.querySelector('.cropper-canvas');
    const ctx     = canvas.getContext('2d');
    const frame   = overlay.querySelector('.cropper-frame');
    const zoomEl  = overlay.querySelector('.cropper-zoom');

    let img = new Image();
    let shape = defaultShape;
    let outSize = defaultSize;
    let scale = 1;
    let offsetX = 0;
    let offsetY = 0;
    let dragging = false;
    let dragStart = { x: 0, y: 0, ox: 0, oy: 0 };

    const close = (result) => {
      overlay.remove();
      resolve(result);
    };

    const getFrame = () => {
      const W = canvas.width;
      const H = canvas.height;
      const ratio = SHAPES[shape].ratio;
      let fw, fh;
      if (ratio >= 1) {
        fw = W * 0.85;
        fh = fw / ratio;
      } else {
        fh = H * 0.85;
        fw = fh * ratio;
      }
      if (fh > H * 0.85) { fh = H * 0.85; fw = fh * ratio; }
      return { x: (W - fw) / 2, y: (H - fh) / 2, w: fw, h: fh };
    };

    const draw = () => {
      const f = getFrame();
      frame.style.left   = `${(f.x / canvas.width) * 100}%`;
      frame.style.top    = `${(f.y / canvas.height) * 100}%`;
      frame.style.width  = `${(f.w / canvas.width) * 100}%`;
      frame.style.height = `${(f.h / canvas.height) * 100}%`;
      frame.classList.toggle('round', SHAPES[shape].round);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#0a0a0c';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const imgScale = Math.max(f.w / img.width, f.h / img.height) * scale;
      const dw = img.width * imgScale;
      const dh = img.height * imgScale;
      const dx = f.x + (f.w - dw) / 2 + offsetX;
      const dy = f.y + (f.h - dh) / 2 + offsetY;

      ctx.save();
      ctx.beginPath();
      ctx.rect(f.x, f.y, f.w, f.h);
      ctx.clip();
      ctx.drawImage(img, dx, dy, dw, dh);
      ctx.restore();

      ctx.strokeStyle = 'rgba(0,191,255,0.6)';
      ctx.lineWidth = 2;
      ctx.strokeRect(f.x + 1, f.y + 1, f.w - 2, f.h - 2);
    };

    const loadFile = (f) => {
      const reader = new FileReader();
      reader.onload = () => {
        img = new Image();
        img.onload = () => {
          scale = 1;
          offsetX = 0;
          offsetY = 0;
          zoomEl.value = '1';
          draw();
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(f);
    };

    const exportBlob = () => {
      draw();
      const f = getFrame();
      const px = SIZES[outSize];
      const outW = SHAPES[shape].ratio >= 1 ? px : Math.round(px * SHAPES[shape].ratio);
      const outH = SHAPES[shape].ratio >= 1 ? Math.round(px / SHAPES[shape].ratio) : px;

      const off = document.createElement('canvas');
      off.width = outW;
      off.height = outH;
      const octx = off.getContext('2d');
      octx.drawImage(canvas, f.x, f.y, f.w, f.h, 0, 0, outW, outH);

      if (SHAPES[shape].round) {
        const masked = document.createElement('canvas');
        masked.width = outW;
        masked.height = outH;
        const mctx = masked.getContext('2d');
        mctx.beginPath();
        mctx.arc(outW / 2, outH / 2, Math.min(outW, outH) / 2, 0, Math.PI * 2);
        mctx.clip();
        mctx.drawImage(off, 0, 0);
        off.width = outW;
        off.height = outH;
        octx.clearRect(0, 0, outW, outH);
        octx.drawImage(masked, 0, 0);
      }

      return new Promise(res => off.toBlob(res, 'image/jpeg', 0.92));
    };

    // Pointer drag
    const onDown = (e) => {
      dragging = true;
      const p = e.touches ? e.touches[0] : e;
      dragStart = { x: p.clientX, y: p.clientY, ox: offsetX, oy: offsetY };
      e.preventDefault();
    };
    const onMove = (e) => {
      if (!dragging) return;
      const p = e.touches ? e.touches[0] : e;
      offsetX = dragStart.ox + (p.clientX - dragStart.x);
      offsetY = dragStart.oy + (p.clientY - dragStart.y);
      draw();
    };
    const onUp = () => { dragging = false; };

    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseup', onUp);
    canvas.addEventListener('mouseleave', onUp);
    canvas.addEventListener('touchstart', onDown, { passive: false });
    canvas.addEventListener('touchmove', onMove, { passive: false });
    canvas.addEventListener('touchend', onUp);

    zoomEl.addEventListener('input', () => {
      scale = parseFloat(zoomEl.value);
      draw();
    });

    overlay.querySelectorAll('.cropper-shape-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        shape = btn.dataset.shape;
        overlay.querySelectorAll('.cropper-shape-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        draw();
      });
    });

    overlay.querySelectorAll('.cropper-size-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        outSize = btn.dataset.size;
        overlay.querySelectorAll('.cropper-size-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    overlay.querySelector('.cropper-close').addEventListener('click', () => close(null));
    overlay.querySelector('.cropper-cancel').addEventListener('click', () => close(null));
    overlay.querySelector('.cropper-apply').addEventListener('click', async () => {
      const blob = await exportBlob();
      close(blob);
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });

    loadFile(file);
  });
}
