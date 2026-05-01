// Audio Nibble - Audio Editor by MooLab
// Vanilla JS audio editing tool with waveform visualization, clipping, and export

(function () {
    'use strict';

    // ─── State ───────────────────────────────────────────────────────
    const state = {
        audioContext: null,
        audioBuffer: null,      // current working buffer
        sourceNode: null,
        gainNode: null,
        isPlaying: false,
        playStartTime: 0,       // audioContext.currentTime when play started
        playOffset: 0,          // offset into buffer when play started
        currentTime: 0,

        // Selection
        selectionStart: null,   // in seconds
        selectionEnd: null,

        // Waveform
        waveformData: null,     // downsampled peaks
        zoom: 1,

        // Drag state
        isDragging: false,
        dragType: null,         // 'select', 'handle-left', 'handle-right'
        dragStartX: 0,

        // History
        history: [],
        historyIndex: -1,

        // File
        fileName: '',
        originalFormat: '',

        // Export
        exportFormat: 'wav',
    };

    // ─── DOM References ──────────────────────────────────────────────
    const $ = (s) => document.querySelector(s);
    const $$ = (s) => document.querySelectorAll(s);

    const dom = {
        dropZone: $('#dropZone'),
        fileInput: $('#fileInput'),
        editor: $('#editor'),
        waveformCanvas: $('#waveformCanvas'),
        waveformWrapper: $('#waveformWrapper'),
        timelineCanvas: $('#timelineCanvas'),
        selectionOverlay: $('#selectionOverlay'),
        handleLeft: $('#handleLeft'),
        handleRight: $('#handleRight'),
        playhead: $('#playhead'),
        fileName: $('#fileName'),
        currentTime: $('#currentTime'),
        totalTime: $('#totalTime'),
        selectionInfo: $('#selectionInfo'),
        selStart: $('#selStart'),
        selEnd: $('#selEnd'),
        selDuration: $('#selDuration'),
        historyList: $('#historyList'),
        zoomIndicator: $('#zoomIndicator'),
        toastContainer: $('#toastContainer'),
        exportProgress: $('#exportProgress'),
        progressFill: $('#progressFill'),
        progressText: $('#progressText'),
        exportFileName: $('#exportFileName'),
        exportFileExt: $('#exportFileExt'),
        formatModal: $('#formatModal'),
    };

    // ─── Initialization ──────────────────────────────────────────────
    function init() {
        initAudioContext();
        bindEvents();
    }

    function initAudioContext() {
        state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        state.gainNode = state.audioContext.createGain();
        state.gainNode.connect(state.audioContext.destination);
    }

    // ─── Event Binding ───────────────────────────────────────────────
    function bindEvents() {
        // File import
        dom.dropZone.addEventListener('click', () => dom.fileInput.click());
        dom.fileInput.addEventListener('change', handleFileSelect);
        dom.dropZone.addEventListener('dragover', handleDragOver);
        dom.dropZone.addEventListener('dragleave', handleDragLeave);
        dom.dropZone.addEventListener('drop', handleDrop);
        $('#btnImport').addEventListener('click', () => dom.fileInput.click());
        $('#btnClose').addEventListener('click', closeFile);

        // Transport
        $('#btnPlay').addEventListener('click', togglePlay);
        $('#btnStop').addEventListener('click', stopPlayback);
        $('#btnSkipStart').addEventListener('click', () => seekTo(0));
        $('#btnSkipEnd').addEventListener('click', () => seekTo(state.audioBuffer ? state.audioBuffer.duration : 0));
        $('#btnRewind').addEventListener('click', () => seekTo(Math.max(0, state.currentTime - 5)));
        $('#btnForward').addEventListener('click', () => {
            if (state.audioBuffer) seekTo(Math.min(state.audioBuffer.duration, state.currentTime + 5));
        });

        // Volume & speed
        $('#volumeSlider').addEventListener('input', (e) => {
            state.gainNode.gain.value = e.target.value / 100;
        });
        $('#speedSlider').addEventListener('input', (e) => {
            const speed = e.target.value / 100;
            $('#speedValue').textContent = speed.toFixed(1) + 'x';
            if (state.sourceNode) state.sourceNode.playbackRate.value = speed;
        });

        // Toolbar
        $('#btnCrop').addEventListener('click', cropToSelection);
        $('#btnCropSelection').addEventListener('click', cropToSelection);
        $('#btnDelete').addEventListener('click', deleteSelection);
        $('#btnFadeIn').addEventListener('click', () => applyFade('in'));
        $('#btnFadeOut').addEventListener('click', () => applyFade('out'));
        $('#btnNormalize').addEventListener('click', normalizeAudio);
        $('#btnReverse').addEventListener('click', reverseAudio);
        $('#btnTrimSilence').addEventListener('click', trimSilence);
        $('#btnSelectAll').addEventListener('click', selectAll);
        $('#btnClearSelection').addEventListener('click', clearSelection);
        $('#btnPlaySelection').addEventListener('click', playSelection);

        // Undo / Redo
        $('#btnUndo').addEventListener('click', undo);
        $('#btnRedo').addEventListener('click', redo);
        $('#btnClearHistory').addEventListener('click', clearHistory);

        // Zoom
        $('#btnZoomIn').addEventListener('click', () => setZoom(state.zoom * 1.5));
        $('#btnZoomOut').addEventListener('click', () => setZoom(state.zoom / 1.5));
        $('#btnZoomFit').addEventListener('click', () => setZoom(1));

        // Effects
        $('#gainSlider').addEventListener('input', (e) => {
            $('#gainValue').textContent = e.target.value + '%';
        });
        $('#stretchSlider').addEventListener('input', (e) => {
            $('#stretchValue').textContent = e.target.value + '%';
        });
        $('#btnApplyGain').addEventListener('click', applyGain);
        $('#btnApplyStretch').addEventListener('click', applyStretch);
        $('#btnInsertSilence').addEventListener('click', insertSilence);

        // Export
        $$('.format-option').forEach(opt => {
            opt.addEventListener('click', () => {
                $$('.format-option').forEach(o => o.classList.remove('selected'));
                opt.classList.add('selected');
                state.exportFormat = opt.dataset.format;
                $('#bitrateRow').style.display = (state.exportFormat === 'mp3') ? 'flex' : 'none';
                dom.exportFileExt.textContent = '.' + state.exportFormat;
            });
        });
        $('#btnExport').addEventListener('click', exportAudio);
        $('#btnExportQuick').addEventListener('click', exportAudio);

        // Format help modal
        $('#btnFormatHelp').addEventListener('click', () => dom.formatModal.classList.add('visible'));
        $('#btnCloseModal').addEventListener('click', () => dom.formatModal.classList.remove('visible'));
        dom.formatModal.addEventListener('click', (e) => {
            if (e.target === dom.formatModal) dom.formatModal.classList.remove('visible');
        });

        // Waveform interaction
        dom.waveformCanvas.addEventListener('mousedown', onWaveformMouseDown);
        dom.handleLeft.addEventListener('mousedown', (e) => startHandleDrag(e, 'handle-left'));
        dom.handleRight.addEventListener('mousedown', (e) => startHandleDrag(e, 'handle-right'));
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);

        // Keyboard
        document.addEventListener('keydown', handleKeyboard);

        // Resize
        window.addEventListener('resize', () => {
            if (state.audioBuffer) {
                drawWaveform();
                drawTimeline();
            }
        });
    }

    // ─── File Handling ───────────────────────────────────────────────
    function handleDragOver(e) {
        e.preventDefault();
        dom.dropZone.classList.add('drag-over');
    }

    function handleDragLeave() {
        dom.dropZone.classList.remove('drag-over');
    }

    function handleDrop(e) {
        e.preventDefault();
        dom.dropZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) loadFile(file);
    }

    function handleFileSelect(e) {
        const file = e.target.files[0];
        if (file) loadFile(file);
    }

    async function loadFile(file) {
        if (!file.type.startsWith('audio/') && !isAudioExtension(file.name)) {
            toast('Please select an audio file', 'error');
            return;
        }

        try {
            state.fileName = file.name;
            state.originalFormat = file.name.split('.').pop().toUpperCase();

            if (state.audioContext.state === 'suspended') {
                await state.audioContext.resume();
            }

            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await state.audioContext.decodeAudioData(arrayBuffer);

            state.audioBuffer = audioBuffer;
            state.history = [cloneBuffer(audioBuffer)];
            state.historyIndex = 0;
            state.currentTime = 0;
            state.selectionStart = null;
            state.selectionEnd = null;
            state.zoom = 1;

            showEditor();
            updateFileInfo();
            // Set export filename to original name without extension
            dom.exportFileName.value = state.fileName.replace(/\.[^.]+$/, '');
            dom.exportFileExt.textContent = '.' + state.exportFormat;
            drawWaveform();
            drawTimeline();
            updateHistoryUI();
            toast('Audio loaded: ' + file.name, 'success');
        } catch (err) {
            console.error('Failed to decode audio:', err);
            toast('Failed to decode audio file. Format may not be supported by your browser.', 'error');
        }
    }

    function isAudioExtension(name) {
        const exts = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'webm', 'wma', 'opus', 'aiff'];
        const ext = name.split('.').pop().toLowerCase();
        return exts.includes(ext);
    }

    function showEditor() {
        dom.dropZone.classList.add('hidden');
        dom.editor.classList.add('visible');
        $('#btnExportQuick').disabled = false;
    }

    function closeFile() {
        stopPlayback();
        state.audioBuffer = null;
        state.history = [];
        state.historyIndex = -1;
        state.selectionStart = null;
        state.selectionEnd = null;
        dom.dropZone.classList.remove('hidden');
        dom.editor.classList.remove('visible');
        $('#btnExportQuick').disabled = true;
        dom.fileInput.value = '';
    }

    function updateFileInfo() {
        const buf = state.audioBuffer;
        dom.fileName.textContent = state.fileName;
        $('#metaDuration').textContent = formatTime(buf.duration);
        $('#metaSampleRate').textContent = buf.sampleRate + ' Hz';
        $('#metaChannels').textContent = buf.numberOfChannels === 1 ? 'Mono' : 'Stereo';
        $('#metaFormat').textContent = state.originalFormat;
        dom.totalTime.textContent = formatTime(buf.duration);
        dom.currentTime.textContent = formatTime(0);
    }

    // ─── Waveform Drawing ────────────────────────────────────────────

    // At zoom=1, the waveform fills the container exactly.
    // pixelsPerSecond = containerWidth / duration, then zoom multiplies it.
    function getPixelsPerSecond() {
        const wrapper = dom.waveformWrapper;
        const buf = state.audioBuffer;
        if (!buf || !buf.duration) return 100;
        return (wrapper.clientWidth / buf.duration) * state.zoom;
    }

    function drawWaveform() {
        const canvas = dom.waveformCanvas;
        const wrapper = dom.waveformWrapper;
        const buf = state.audioBuffer;
        if (!buf) return;

        const pps = getPixelsPerSecond();
        const wrapperWidth = wrapper.clientWidth;
        // At zoom=1 audioWidth == wrapperWidth exactly; zooming in makes it larger
        const canvasWidth = Math.max(wrapperWidth, Math.ceil(buf.duration * pps));
        const height = 200;
        const dpr = window.devicePixelRatio || 1;

        canvas.width = canvasWidth * dpr;
        canvas.height = height * dpr;
        canvas.style.width = canvasWidth + 'px';
        canvas.style.height = height + 'px';

        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        // Background
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--waveform-bg').trim();
        ctx.fillRect(0, 0, canvasWidth, height);

        // Center line
        ctx.strokeStyle = 'rgba(108, 92, 231, 0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(canvasWidth, height / 2);
        ctx.stroke();

        // Draw waveform for each channel — map samples to exactly canvasWidth pixels
        const channels = buf.numberOfChannels;
        const channelHeight = height / channels;

        for (let ch = 0; ch < channels; ch++) {
            const data = buf.getChannelData(ch);
            const centerY = channelHeight * ch + channelHeight / 2;

            ctx.beginPath();
            for (let i = 0; i < canvasWidth; i++) {
                const start = Math.floor(i * data.length / canvasWidth);
                const end = Math.min(Math.floor((i + 1) * data.length / canvasWidth), data.length);
                let min = 1, max = -1;
                for (let j = start; j < end; j++) {
                    if (data[j] < min) min = data[j];
                    if (data[j] > max) max = data[j];
                }
                const yMin = centerY + min * (channelHeight / 2) * 0.9;
                const yMax = centerY + max * (channelHeight / 2) * 0.9;

                ctx.moveTo(i, yMin);
                ctx.lineTo(i, yMax);
            }
            ctx.strokeStyle = '#6c5ce7';
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        // Update zoom indicator
        dom.zoomIndicator.textContent = Math.round(state.zoom * 100) + '%';
    }

    function drawTimeline() {
        const canvas = dom.timelineCanvas;
        const wrapper = dom.waveformWrapper;
        const buf = state.audioBuffer;
        if (!buf) return;

        const pps = getPixelsPerSecond();
        const wrapperWidth = wrapper.clientWidth;
        const canvasWidth = Math.max(wrapperWidth, Math.ceil(buf.duration * pps));
        const height = 24;
        const dpr = window.devicePixelRatio || 1;

        canvas.width = canvasWidth * dpr;
        canvas.height = height * dpr;
        canvas.style.width = canvasWidth + 'px';
        canvas.style.height = height + 'px';

        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        ctx.fillStyle = '#1a1d27';
        ctx.fillRect(0, 0, canvasWidth, height);

        // Determine tick interval based on pixels-per-second
        // Higher pps = more detail visible, so use smaller intervals
        let interval = 1;
        if (pps >= 2000) interval = 0.05;
        else if (pps >= 1000) interval = 0.1;
        else if (pps >= 600) interval = 0.25;
        else if (pps >= 300) interval = 0.5;
        else if (pps >= 100) interval = 1;
        else if (pps >= 50) interval = 2;
        else if (pps >= 20) interval = 5;
        else interval = 10;

        ctx.strokeStyle = '#2d3045';
        ctx.fillStyle = '#5a5c72';
        ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'center';

        // Draw major ticks — use <= and round to avoid floating point drift skipping the last tick
        const totalTicks = Math.floor(buf.duration / interval);
        for (let n = 0; n <= totalTicks; n++) {
            const t = n * interval;
            const x = Math.round(t * pps);
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, 8);
            ctx.stroke();
            ctx.fillText(formatTimeShort(t), x, 20);
        }

        // Always draw a final tick at the exact end of the file
        const endX = Math.round(buf.duration * pps);
        // Only draw if it doesn't overlap with the last major tick
        const lastMajorX = Math.round(totalTicks * interval * pps);
        if (endX - lastMajorX > 20) {
            ctx.strokeStyle = '#4a4c62';
            ctx.beginPath();
            ctx.moveTo(endX, 0);
            ctx.lineTo(endX, 10);
            ctx.stroke();
            ctx.fillStyle = '#8b8da3';
            ctx.fillText(formatTimeShort(buf.duration), endX, 20);
        }

        // Sub-ticks
        const subInterval = interval / 4;
        const totalSubTicks = Math.floor(buf.duration / subInterval);
        ctx.strokeStyle = '#242836';
        for (let n = 0; n <= totalSubTicks; n++) {
            const t = n * subInterval;
            const x = Math.round(t * pps);
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, 4);
            ctx.stroke();
        }
    }

    // ─── Waveform Interaction ────────────────────────────────────────
    function getTimeFromX(clientX) {
        const wrapper = dom.waveformWrapper;
        const rect = dom.waveformCanvas.getBoundingClientRect();
        const x = clientX - rect.left + wrapper.scrollLeft;
        const pps = getPixelsPerSecond();
        return Math.max(0, Math.min(state.audioBuffer.duration, x / pps));
    }

    function getXFromTime(time) {
        return time * getPixelsPerSecond();
    }

    function onWaveformMouseDown(e) {
        if (!state.audioBuffer) return;
        if (e.button !== 0) return;

        state.isDragging = true;
        state.dragType = 'select';
        const time = getTimeFromX(e.clientX);
        state.selectionStart = time;
        state.selectionEnd = time;
        state.dragStartX = e.clientX;

        updateSelectionUI();
    }

    function startHandleDrag(e, type) {
        e.preventDefault();
        e.stopPropagation();
        state.isDragging = true;
        state.dragType = type;
    }

    function onMouseMove(e) {
        if (!state.isDragging || !state.audioBuffer) return;

        const time = getTimeFromX(e.clientX);

        if (state.dragType === 'select') {
            state.selectionEnd = time;
        } else if (state.dragType === 'handle-left') {
            state.selectionStart = Math.min(time, state.selectionEnd);
        } else if (state.dragType === 'handle-right') {
            state.selectionEnd = Math.max(time, state.selectionStart);
        }

        updateSelectionUI();
    }

    function onMouseUp() {
        if (state.isDragging && state.audioBuffer) {
            // Normalize selection so start < end
            if (state.selectionStart !== null && state.selectionEnd !== null) {
                if (state.selectionStart > state.selectionEnd) {
                    [state.selectionStart, state.selectionEnd] = [state.selectionEnd, state.selectionStart];
                }
                // If selection is too small, treat as click (set playhead)
                if (Math.abs(state.selectionEnd - state.selectionStart) < 0.005) {
                    seekTo(state.selectionStart);
                    state.selectionStart = null;
                    state.selectionEnd = null;
                }
            }
            updateSelectionUI();
            updateSelectionButtons();
        }
        state.isDragging = false;
        state.dragType = null;
    }

    function updateSelectionUI() {
        const overlay = dom.selectionOverlay;
        const info = dom.selectionInfo;

        if (state.selectionStart === null || state.selectionEnd === null) {
            overlay.classList.remove('visible');
            info.classList.remove('visible');
            return;
        }

        const start = Math.min(state.selectionStart, state.selectionEnd);
        const end = Math.max(state.selectionStart, state.selectionEnd);
        const duration = end - start;

        if (duration < 0.005) {
            overlay.classList.remove('visible');
            info.classList.remove('visible');
            return;
        }

        const leftPx = getXFromTime(start);
        const widthPx = getXFromTime(end) - leftPx;

        overlay.style.left = leftPx + 'px';
        overlay.style.width = widthPx + 'px';
        overlay.classList.add('visible');

        dom.selStart.textContent = formatTime(start);
        dom.selEnd.textContent = formatTime(end);
        dom.selDuration.textContent = formatTime(duration);
        info.classList.add('visible');
    }

    function updateSelectionButtons() {
        const hasSelection = state.selectionStart !== null && state.selectionEnd !== null &&
            Math.abs(state.selectionEnd - state.selectionStart) >= 0.005;
        $('#btnCrop').disabled = !hasSelection;
        $('#btnDelete').disabled = !hasSelection;
        $('#btnFadeIn').disabled = !hasSelection;
        $('#btnFadeOut').disabled = !hasSelection;
        $('#btnClearSelection').disabled = !hasSelection;
    }

    // ─── Playback ────────────────────────────────────────────────────
    function togglePlay() {
        if (state.isPlaying) {
            pausePlayback();
        } else {
            startPlayback();
        }
    }

    function startPlayback(startTime, endTime) {
        if (!state.audioBuffer) return;
        stopPlaybackInternal();

        if (state.audioContext.state === 'suspended') {
            state.audioContext.resume();
        }

        const source = state.audioContext.createBufferSource();
        source.buffer = state.audioBuffer;
        source.connect(state.gainNode);
        source.playbackRate.value = $('#speedSlider').value / 100;

        const offset = startTime !== undefined ? startTime : state.currentTime;
        const duration = endTime !== undefined ? (endTime - offset) : undefined;

        source.start(0, offset, duration);
        source.onended = () => {
            if (state.isPlaying) {
                state.isPlaying = false;
                state.currentTime = endTime !== undefined ? endTime : state.audioBuffer.duration;
                updatePlayButton();
                updatePlayhead();
            }
        };

        state.sourceNode = source;
        state.playStartTime = state.audioContext.currentTime;
        state.playOffset = offset;
        state.isPlaying = true;

        updatePlayButton();
        requestAnimationFrame(updatePlaybackPosition);
    }

    function pausePlayback() {
        if (state.sourceNode) {
            state.currentTime = getCurrentPlaybackTime();
            state.sourceNode.onended = null;
            state.sourceNode.stop();
            state.sourceNode.disconnect();
            state.sourceNode = null;
        }
        state.isPlaying = false;
        updatePlayButton();
    }

    function stopPlayback() {
        stopPlaybackInternal();
        state.currentTime = 0;
        state.isPlaying = false;
        updatePlayButton();
        updatePlayhead();
        dom.currentTime.textContent = formatTime(0);
    }

    function stopPlaybackInternal() {
        if (state.sourceNode) {
            state.sourceNode.onended = null;
            try { state.sourceNode.stop(); } catch (e) {}
            state.sourceNode.disconnect();
            state.sourceNode = null;
        }
    }

    function seekTo(time) {
        const wasPlaying = state.isPlaying;
        if (wasPlaying) stopPlaybackInternal();
        state.currentTime = time;
        state.isPlaying = false;
        updatePlayButton();
        updatePlayhead();
        dom.currentTime.textContent = formatTime(time);
        if (wasPlaying) startPlayback(time);
    }

    function getCurrentPlaybackTime() {
        if (!state.isPlaying) return state.currentTime;
        const speed = state.sourceNode ? state.sourceNode.playbackRate.value : 1;
        const elapsed = (state.audioContext.currentTime - state.playStartTime) * speed;
        return Math.min(state.playOffset + elapsed, state.audioBuffer.duration);
    }

    function updatePlaybackPosition() {
        if (!state.isPlaying) return;
        state.currentTime = getCurrentPlaybackTime();
        dom.currentTime.textContent = formatTime(state.currentTime);
        updatePlayhead();
        requestAnimationFrame(updatePlaybackPosition);
    }

    function updatePlayhead() {
        if (!state.audioBuffer) return;
        const x = getXFromTime(state.currentTime);
        dom.playhead.style.left = x + 'px';
        dom.playhead.classList.add('visible');

        // Auto-scroll to follow playhead
        if (state.isPlaying) {
            const wrapper = dom.waveformWrapper;
            const visibleLeft = wrapper.scrollLeft;
            const visibleRight = visibleLeft + wrapper.clientWidth;
            if (x > visibleRight - 50 || x < visibleLeft) {
                wrapper.scrollLeft = x - 100;
            }
        }
    }

    function updatePlayButton() {
        $('#playIcon').style.display = state.isPlaying ? 'none' : 'block';
        $('#pauseIcon').style.display = state.isPlaying ? 'block' : 'none';
    }

    function playSelection() {
        if (state.selectionStart === null || state.selectionEnd === null) return;
        const start = Math.min(state.selectionStart, state.selectionEnd);
        const end = Math.max(state.selectionStart, state.selectionEnd);
        startPlayback(start, end);
    }

    // ─── Editing Operations ──────────────────────────────────────────
    function pushHistory(label) {
        // Remove any future history
        state.history = state.history.slice(0, state.historyIndex + 1);
        state.history.push(cloneBuffer(state.audioBuffer));
        state.historyIndex = state.history.length - 1;

        // Limit history size
        if (state.history.length > 30) {
            state.history.shift();
            state.historyIndex--;
        }

        updateHistoryUI(label);
        updateUndoRedoButtons();
    }

    function undo() {
        if (state.historyIndex <= 0) return;
        stopPlayback();
        state.historyIndex--;
        state.audioBuffer = cloneBuffer(state.history[state.historyIndex]);
        state.selectionStart = null;
        state.selectionEnd = null;
        refreshAfterEdit();
        toast('Undo', 'info');
    }

    function redo() {
        if (state.historyIndex >= state.history.length - 1) return;
        stopPlayback();
        state.historyIndex++;
        state.audioBuffer = cloneBuffer(state.history[state.historyIndex]);
        state.selectionStart = null;
        state.selectionEnd = null;
        refreshAfterEdit();
        toast('Redo', 'info');
    }

    function clearHistory() {
        state.history = [cloneBuffer(state.audioBuffer)];
        state.historyIndex = 0;
        updateHistoryUI();
        updateUndoRedoButtons();
    }

    function updateUndoRedoButtons() {
        $('#btnUndo').disabled = state.historyIndex <= 0;
        $('#btnRedo').disabled = state.historyIndex >= state.history.length - 1;
    }

    function updateHistoryUI(label) {
        const list = dom.historyList;
        if (label) {
            const item = document.createElement('div');
            item.className = 'history-item current';
            item.innerHTML = `<div class="history-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><circle cx="12" cy="12" r="10"/></svg></div><span>${label}</span>`;
            list.querySelectorAll('.current').forEach(el => el.classList.remove('current'));
            list.appendChild(item);
            list.scrollTop = list.scrollHeight;
        }
    }

    function refreshAfterEdit() {
        updateFileInfo();
        drawWaveform();
        drawTimeline();
        updateSelectionUI();
        updateSelectionButtons();
        updateUndoRedoButtons();
        updatePlayhead();
    }

    function cropToSelection() {
        if (state.selectionStart === null || state.selectionEnd === null) return;
        stopPlayback();

        const start = Math.min(state.selectionStart, state.selectionEnd);
        const end = Math.max(state.selectionStart, state.selectionEnd);

        state.audioBuffer = sliceBuffer(state.audioBuffer, start, end);
        state.selectionStart = null;
        state.selectionEnd = null;
        state.currentTime = 0;

        pushHistory('Crop to selection');
        refreshAfterEdit();
        toast('Cropped to selection', 'success');
    }

    function deleteSelection() {
        if (state.selectionStart === null || state.selectionEnd === null) return;
        stopPlayback();

        const buf = state.audioBuffer;
        const start = Math.min(state.selectionStart, state.selectionEnd);
        const end = Math.max(state.selectionStart, state.selectionEnd);

        const startSample = Math.floor(start * buf.sampleRate);
        const endSample = Math.floor(end * buf.sampleRate);
        const newLength = buf.length - (endSample - startSample);

        if (newLength <= 0) {
            toast('Cannot delete entire audio', 'error');
            return;
        }

        const newBuffer = state.audioContext.createBuffer(
            buf.numberOfChannels, newLength, buf.sampleRate
        );

        for (let ch = 0; ch < buf.numberOfChannels; ch++) {
            const oldData = buf.getChannelData(ch);
            const newData = newBuffer.getChannelData(ch);
            // Copy before selection
            newData.set(oldData.subarray(0, startSample));
            // Copy after selection
            newData.set(oldData.subarray(endSample), startSample);
        }

        state.audioBuffer = newBuffer;
        state.selectionStart = null;
        state.selectionEnd = null;
        state.currentTime = Math.min(state.currentTime, newBuffer.duration);

        pushHistory('Delete selection');
        refreshAfterEdit();
        toast('Selection deleted', 'success');
    }

    function applyFade(type) {
        if (state.selectionStart === null || state.selectionEnd === null) return;
        stopPlayback();

        const buf = state.audioBuffer;
        const start = Math.min(state.selectionStart, state.selectionEnd);
        const end = Math.max(state.selectionStart, state.selectionEnd);
        const startSample = Math.floor(start * buf.sampleRate);
        const endSample = Math.floor(end * buf.sampleRate);
        const length = endSample - startSample;

        // Clone first
        const newBuffer = cloneBuffer(buf);

        for (let ch = 0; ch < newBuffer.numberOfChannels; ch++) {
            const data = newBuffer.getChannelData(ch);
            for (let i = 0; i < length; i++) {
                const factor = type === 'in' ? (i / length) : (1 - i / length);
                data[startSample + i] *= factor;
            }
        }

        state.audioBuffer = newBuffer;
        pushHistory('Fade ' + type);
        refreshAfterEdit();
        toast('Fade ' + type + ' applied', 'success');
    }

    function normalizeAudio() {
        if (!state.audioBuffer) return;
        stopPlayback();

        const buf = state.audioBuffer;
        let maxVal = 0;
        for (let ch = 0; ch < buf.numberOfChannels; ch++) {
            const data = buf.getChannelData(ch);
            for (let i = 0; i < data.length; i++) {
                const abs = Math.abs(data[i]);
                if (abs > maxVal) maxVal = abs;
            }
        }

        if (maxVal === 0 || maxVal >= 0.99) {
            toast('Audio is already normalized', 'info');
            return;
        }

        const gain = 1.0 / maxVal;
        const newBuffer = cloneBuffer(buf);
        for (let ch = 0; ch < newBuffer.numberOfChannels; ch++) {
            const data = newBuffer.getChannelData(ch);
            for (let i = 0; i < data.length; i++) {
                data[i] *= gain;
            }
        }

        state.audioBuffer = newBuffer;
        pushHistory('Normalize');
        refreshAfterEdit();
        toast('Audio normalized (gain: ' + gain.toFixed(2) + 'x)', 'success');
    }

    function reverseAudio() {
        if (!state.audioBuffer) return;
        stopPlayback();

        const buf = state.audioBuffer;
        const newBuffer = cloneBuffer(buf);

        // If there's a selection, reverse only the selection
        let startSample = 0;
        let endSample = buf.length;
        if (state.selectionStart !== null && state.selectionEnd !== null) {
            const start = Math.min(state.selectionStart, state.selectionEnd);
            const end = Math.max(state.selectionStart, state.selectionEnd);
            startSample = Math.floor(start * buf.sampleRate);
            endSample = Math.floor(end * buf.sampleRate);
        }

        for (let ch = 0; ch < newBuffer.numberOfChannels; ch++) {
            const data = newBuffer.getChannelData(ch);
            const segment = data.slice(startSample, endSample);
            segment.reverse();
            data.set(segment, startSample);
        }

        state.audioBuffer = newBuffer;
        pushHistory('Reverse');
        refreshAfterEdit();
        toast('Audio reversed', 'success');
    }

    function trimSilence() {
        if (!state.audioBuffer) return;
        stopPlayback();

        const buf = state.audioBuffer;
        const threshold = 0.01;
        let startSample = 0;
        let endSample = buf.length - 1;

        // Find first non-silent sample
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
            if (Math.abs(data[i]) > threshold) {
                startSample = Math.max(0, i - 100); // Keep small margin
                break;
            }
        }

        // Find last non-silent sample
        for (let i = data.length - 1; i >= 0; i--) {
            if (Math.abs(data[i]) > threshold) {
                endSample = Math.min(data.length - 1, i + 100);
                break;
            }
        }

        if (startSample === 0 && endSample === buf.length - 1) {
            toast('No silence found to trim', 'info');
            return;
        }

        const startTime = startSample / buf.sampleRate;
        const endTime = endSample / buf.sampleRate;

        state.audioBuffer = sliceBuffer(buf, startTime, endTime);
        state.selectionStart = null;
        state.selectionEnd = null;
        state.currentTime = 0;

        pushHistory('Trim silence');
        refreshAfterEdit();
        toast('Silence trimmed', 'success');
    }

    function applyGain() {
        if (!state.audioBuffer) return;
        stopPlayback();

        const gainValue = $('#gainSlider').value / 100;
        const buf = state.audioBuffer;
        const newBuffer = cloneBuffer(buf);

        let startSample = 0;
        let endSample = buf.length;
        if (state.selectionStart !== null && state.selectionEnd !== null) {
            const start = Math.min(state.selectionStart, state.selectionEnd);
            const end = Math.max(state.selectionStart, state.selectionEnd);
            startSample = Math.floor(start * buf.sampleRate);
            endSample = Math.floor(end * buf.sampleRate);
        }

        for (let ch = 0; ch < newBuffer.numberOfChannels; ch++) {
            const data = newBuffer.getChannelData(ch);
            for (let i = startSample; i < endSample; i++) {
                data[i] = Math.max(-1, Math.min(1, data[i] * gainValue));
            }
        }

        state.audioBuffer = newBuffer;
        pushHistory('Gain ' + Math.round(gainValue * 100) + '%');
        refreshAfterEdit();
        toast('Gain applied: ' + Math.round(gainValue * 100) + '%', 'success');
    }

    function applyStretch() {
        if (!state.audioBuffer) return;
        stopPlayback();

        const speedFactor = $('#stretchSlider').value / 100;
        const buf = state.audioBuffer;
        const newLength = Math.floor(buf.length / speedFactor);
        const newBuffer = state.audioContext.createBuffer(buf.numberOfChannels, newLength, buf.sampleRate);

        for (let ch = 0; ch < buf.numberOfChannels; ch++) {
            const oldData = buf.getChannelData(ch);
            const newData = newBuffer.getChannelData(ch);
            for (let i = 0; i < newLength; i++) {
                const srcIdx = i * speedFactor;
                const idx = Math.floor(srcIdx);
                const frac = srcIdx - idx;
                const a = oldData[idx] || 0;
                const b = oldData[idx + 1] || 0;
                newData[i] = a + (b - a) * frac;
            }
        }

        state.audioBuffer = newBuffer;
        state.selectionStart = null;
        state.selectionEnd = null;
        state.currentTime = 0;

        pushHistory('Speed ' + Math.round(speedFactor * 100) + '%');
        refreshAfterEdit();
        toast('Speed changed to ' + Math.round(speedFactor * 100) + '%', 'success');
    }

    function insertSilence() {
        if (!state.audioBuffer) return;
        stopPlayback();

        const seconds = parseFloat($('#silenceDuration').value) || 1;
        const buf = state.audioBuffer;
        const silenceSamples = Math.floor(seconds * buf.sampleRate);
        const insertAt = state.selectionStart !== null
            ? Math.floor(Math.min(state.selectionStart, state.selectionEnd || state.selectionStart) * buf.sampleRate)
            : Math.floor(state.currentTime * buf.sampleRate);

        const newBuffer = state.audioContext.createBuffer(
            buf.numberOfChannels, buf.length + silenceSamples, buf.sampleRate
        );

        for (let ch = 0; ch < buf.numberOfChannels; ch++) {
            const oldData = buf.getChannelData(ch);
            const newData = newBuffer.getChannelData(ch);
            newData.set(oldData.subarray(0, insertAt));
            // Silence is already zeros
            newData.set(oldData.subarray(insertAt), insertAt + silenceSamples);
        }

        state.audioBuffer = newBuffer;
        state.selectionStart = null;
        state.selectionEnd = null;

        pushHistory('Insert ' + seconds + 's silence');
        refreshAfterEdit();
        toast(seconds + 's of silence inserted', 'success');
    }

    function selectAll() {
        if (!state.audioBuffer) return;
        state.selectionStart = 0;
        state.selectionEnd = state.audioBuffer.duration;
        updateSelectionUI();
        updateSelectionButtons();
    }

    function clearSelection() {
        state.selectionStart = null;
        state.selectionEnd = null;
        updateSelectionUI();
        updateSelectionButtons();
    }

    // ─── Zoom ────────────────────────────────────────────────────────
    function setZoom(z) {
        state.zoom = Math.max(0.1, Math.min(50, z));
        drawWaveform();
        drawTimeline();
        updateSelectionUI();
        updatePlayhead();
    }

    // ─── Export ──────────────────────────────────────────────────────
    async function exportAudio() {
        if (!state.audioBuffer) return;

        const format = state.exportFormat;
        const buf = state.audioBuffer;

        // Resample if needed
        let exportBuffer = buf;
        const targetSampleRate = parseInt($('#exportSampleRate').value) || buf.sampleRate;
        const targetChannels = parseInt($('#exportChannels').value) || buf.numberOfChannels;

        if (targetSampleRate !== buf.sampleRate || targetChannels !== buf.numberOfChannels) {
            exportBuffer = await resampleBuffer(buf, targetSampleRate, targetChannels);
        }

        dom.exportProgress.classList.add('visible');
        dom.progressFill.style.width = '0%';
        dom.progressText.textContent = 'Encoding ' + format.toUpperCase() + '...';

        try {
            let blob;
            switch (format) {
                case 'wav':
                    blob = encodeWAV(exportBuffer);
                    break;
                case 'mp3':
                    blob = await encodeMP3(exportBuffer);
                    break;
                case 'ogg':
                case 'webm':
                    blob = await encodeWithMediaRecorder(exportBuffer, format);
                    break;
                default:
                    blob = encodeWAV(exportBuffer);
            }

            dom.progressFill.style.width = '100%';
            dom.progressText.textContent = 'Done!';

            const customName = dom.exportFileName.value.trim();
            const baseName = customName || state.fileName.replace(/\.[^.]+$/, '');
            downloadBlob(blob, baseName + '.' + format);
            toast('Exported as ' + format.toUpperCase(), 'success');
        } catch (err) {
            console.error('Export error:', err);
            toast('Export failed: ' + err.message, 'error');
        }

        setTimeout(() => {
            dom.exportProgress.classList.remove('visible');
        }, 2000);
    }

    function encodeWAV(buffer) {
        const numChannels = buffer.numberOfChannels;
        const sampleRate = buffer.sampleRate;
        const bitsPerSample = 16;
        const bytesPerSample = bitsPerSample / 8;
        const blockAlign = numChannels * bytesPerSample;

        // Interleave channels
        const length = buffer.length;
        const interleaved = new Int16Array(length * numChannels);

        for (let i = 0; i < length; i++) {
            for (let ch = 0; ch < numChannels; ch++) {
                const sample = buffer.getChannelData(ch)[i];
                const clamped = Math.max(-1, Math.min(1, sample));
                interleaved[i * numChannels + ch] = clamped < 0 ? clamped * 32768 : clamped * 32767;
            }
        }

        const dataSize = interleaved.length * bytesPerSample;
        const headerSize = 44;
        const arrayBuffer = new ArrayBuffer(headerSize + dataSize);
        const view = new DataView(arrayBuffer);

        // RIFF header
        writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        writeString(view, 8, 'WAVE');

        // fmt chunk
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);           // chunk size
        view.setUint16(20, 1, true);             // PCM format
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * blockAlign, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitsPerSample, true);

        // data chunk
        writeString(view, 36, 'data');
        view.setUint32(40, dataSize, true);

        // Write samples
        const output = new Int16Array(arrayBuffer, headerSize);
        output.set(interleaved);

        return new Blob([arrayBuffer], { type: 'audio/wav' });
    }

    function writeString(view, offset, str) {
        for (let i = 0; i < str.length; i++) {
            view.setUint8(offset + i, str.charCodeAt(i));
        }
    }

    async function encodeMP3(buffer) {
        if (typeof lamejs === 'undefined') {
            throw new Error('MP3 encoder not loaded. Please try WAV format.');
        }

        const numChannels = buffer.numberOfChannels;
        const sampleRate = buffer.sampleRate;
        const kbps = parseInt($('#exportBitrate').value) || 192;

        const mp3encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, kbps);
        const blockSize = 1152;
        const mp3Data = [];

        // Get channel data as Int16
        const channels = [];
        for (let ch = 0; ch < numChannels; ch++) {
            const float32 = buffer.getChannelData(ch);
            const int16 = new Int16Array(float32.length);
            for (let i = 0; i < float32.length; i++) {
                const s = Math.max(-1, Math.min(1, float32[i]));
                int16[i] = s < 0 ? s * 32768 : s * 32767;
            }
            channels.push(int16);
        }

        const totalBlocks = Math.ceil(channels[0].length / blockSize);
        let processedBlocks = 0;

        for (let i = 0; i < channels[0].length; i += blockSize) {
            const leftChunk = channels[0].subarray(i, i + blockSize);
            const rightChunk = numChannels > 1
                ? channels[1].subarray(i, i + blockSize)
                : leftChunk;

            let mp3buf;
            if (numChannels === 1) {
                mp3buf = mp3encoder.encodeBuffer(leftChunk);
            } else {
                mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
            }

            if (mp3buf.length > 0) {
                mp3Data.push(mp3buf);
            }

            processedBlocks++;
            if (processedBlocks % 100 === 0) {
                const progress = Math.round((processedBlocks / totalBlocks) * 100);
                dom.progressFill.style.width = progress + '%';
                dom.progressText.textContent = 'Encoding MP3... ' + progress + '%';
                // Yield to UI
                await new Promise(r => setTimeout(r, 0));
            }
        }

        const end = mp3encoder.flush();
        if (end.length > 0) mp3Data.push(end);

        return new Blob(mp3Data, { type: 'audio/mp3' });
    }

    async function encodeWithMediaRecorder(buffer, format) {
        // Use OfflineAudioContext + MediaRecorder approach
        const mimeType = format === 'ogg' ? 'audio/ogg; codecs=opus' : 'audio/webm; codecs=opus';

        if (!MediaRecorder.isTypeSupported(mimeType)) {
            // Fallback: try without codec spec
            const fallback = format === 'ogg' ? 'audio/ogg' : 'audio/webm';
            if (!MediaRecorder.isTypeSupported(fallback)) {
                throw new Error(format.toUpperCase() + ' encoding is not supported in your browser. Try WAV or MP3.');
            }
        }

        return new Promise((resolve, reject) => {
            const ctx = new AudioContext({ sampleRate: buffer.sampleRate });
            const source = ctx.createBufferSource();
            source.buffer = buffer;

            const dest = ctx.createMediaStreamDestination();
            source.connect(dest);

            const actualMime = MediaRecorder.isTypeSupported(mimeType) ? mimeType :
                (format === 'ogg' ? 'audio/ogg' : 'audio/webm');
            const recorder = new MediaRecorder(dest.stream, { mimeType: actualMime });
            const chunks = [];

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunks.push(e.data);
            };

            recorder.onstop = () => {
                ctx.close();
                const blobType = format === 'ogg' ? 'audio/ogg' : 'audio/webm';
                resolve(new Blob(chunks, { type: blobType }));
            };

            recorder.onerror = (e) => {
                ctx.close();
                reject(new Error('Recording failed'));
            };

            recorder.start();
            source.start(0);
            source.onended = () => {
                setTimeout(() => recorder.stop(), 100);
            };

            // Progress simulation
            const duration = buffer.duration * 1000;
            const interval = setInterval(() => {
                if (recorder.state === 'inactive') {
                    clearInterval(interval);
                    return;
                }
                const elapsed = ctx.currentTime * 1000;
                const progress = Math.min(95, Math.round((elapsed / duration) * 100));
                dom.progressFill.style.width = progress + '%';
                dom.progressText.textContent = 'Encoding ' + format.toUpperCase() + '... ' + progress + '%';
            }, 200);
        });
    }

    async function resampleBuffer(buffer, targetSampleRate, targetChannels) {
        const duration = buffer.duration;
        const offlineCtx = new OfflineAudioContext(
            targetChannels,
            Math.ceil(duration * targetSampleRate),
            targetSampleRate
        );

        const source = offlineCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(offlineCtx.destination);
        source.start(0);

        return await offlineCtx.startRendering();
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ─── Buffer Utilities ────────────────────────────────────────────
    function cloneBuffer(buffer) {
        const newBuffer = state.audioContext.createBuffer(
            buffer.numberOfChannels, buffer.length, buffer.sampleRate
        );
        for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
            newBuffer.copyToChannel(buffer.getChannelData(ch).slice(), ch);
        }
        return newBuffer;
    }

    function sliceBuffer(buffer, startTime, endTime) {
        const startSample = Math.floor(startTime * buffer.sampleRate);
        const endSample = Math.floor(endTime * buffer.sampleRate);
        const length = endSample - startSample;

        const newBuffer = state.audioContext.createBuffer(
            buffer.numberOfChannels, length, buffer.sampleRate
        );

        for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
            const data = buffer.getChannelData(ch);
            newBuffer.copyToChannel(data.slice(startSample, endSample), ch);
        }

        return newBuffer;
    }

    // ─── Keyboard Shortcuts ──────────────────────────────────────────
    function handleKeyboard(e) {
        if (!state.audioBuffer) return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

        switch (e.key) {
            case ' ':
                e.preventDefault();
                togglePlay();
                break;
            case 'Home':
                e.preventDefault();
                seekTo(0);
                break;
            case 'End':
                e.preventDefault();
                seekTo(state.audioBuffer.duration);
                break;
            case 'Delete':
                e.preventDefault();
                deleteSelection();
                break;
            case 'Escape':
                e.preventDefault();
                if (dom.formatModal.classList.contains('visible')) {
                    dom.formatModal.classList.remove('visible');
                } else {
                    clearSelection();
                }
                break;
            case '+':
            case '=':
                e.preventDefault();
                setZoom(state.zoom * 1.5);
                break;
            case '-':
            case '_':
                e.preventDefault();
                setZoom(state.zoom / 1.5);
                break;
            case 'z':
            case 'Z':
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    if (e.shiftKey) redo();
                    else undo();
                }
                break;
            case 'y':
            case 'Y':
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    redo();
                }
                break;
            case 'a':
            case 'A':
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    selectAll();
                }
                break;
            case 'X':
            case 'x':
                if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
                    e.preventDefault();
                    cropToSelection();
                }
                break;
            case 's':
            case 'S':
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    exportAudio();
                }
                break;
        }
    }

    // ─── Formatting ──────────────────────────────────────────────────
    function formatTime(seconds) {
        if (!isFinite(seconds)) return '0:00.000';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 1000);
        return mins + ':' + String(secs).padStart(2, '0') + '.' + String(ms).padStart(3, '0');
    }

    function formatTimeShort(seconds) {
        if (!isFinite(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        if (seconds < 60) {
            const dec = Math.round((seconds % 1) * 10);
            return secs + '.' + dec + 's';
        }
        return mins + ':' + String(secs).padStart(2, '0');
    }

    // ─── Toast Notifications ─────────────────────────────────────────
    function toast(message, type = 'info') {
        const el = document.createElement('div');
        el.className = 'toast toast-' + type;
        el.textContent = message;
        dom.toastContainer.appendChild(el);

        setTimeout(() => {
            el.style.opacity = '0';
            el.style.transition = 'opacity 0.3s';
            setTimeout(() => el.remove(), 300);
        }, 3000);
    }

    // ─── Start ───────────────────────────────────────────────────────
    init();
})();
