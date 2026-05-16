// client/audio-player.js — shared custom audio player
(function () {
    const PLAY = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
    const PAUSE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;

    function fmt(s) {
        if (!isFinite(s) || isNaN(s)) return '0:00';
        return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    }

    function setScrubberFill(scrubber, pct) {
        scrubber.style.background =
            `linear-gradient(to right, #2563eb ${pct}%, rgba(255,255,255,0.12) ${pct}%)`;
    }

    window.buildAudioPlayer = function (src, onPlay) {
        const audio = new Audio(src);
        audio.preload = 'metadata';

        const wrap = document.createElement('div');
        wrap.className = 'audio-player';

        const playBtn = document.createElement('button');
        playBtn.className = 'ap-play-btn';
        playBtn.type = 'button';
        playBtn.innerHTML = PLAY;
        playBtn.setAttribute('aria-label', 'Play');

        const scrubWrap = document.createElement('div');
        scrubWrap.className = 'ap-scrubber-wrap';

        const scrubber = document.createElement('input');
        scrubber.type = 'range';
        scrubber.className = 'ap-scrubber';
        scrubber.min = '0';
        scrubber.max = '100';
        scrubber.value = '0';
        scrubber.step = '0.1';
        setScrubberFill(scrubber, 0);

        const timeEl = document.createElement('span');
        timeEl.className = 'ap-time';
        timeEl.textContent = '0:00';

        scrubWrap.appendChild(scrubber);
        wrap.appendChild(playBtn);
        wrap.appendChild(scrubWrap);
        wrap.appendChild(timeEl);

        function setPlayState(playing) {
            playBtn.innerHTML = playing ? PAUSE : PLAY;
            playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
            wrap.classList.toggle('is-playing', playing);
        }

        playBtn.addEventListener('click', () => {
            if (audio.paused) {
                // Pause any other active players on the page
                document.querySelectorAll('.audio-player.is-playing').forEach(p => {
                    if (p !== wrap && p._audio) p._audio.pause();
                });
                audio.play().catch(() => {});
                if (onPlay) onPlay();
            } else {
                audio.pause();
            }
        });

        audio.onplay = () => setPlayState(true);
        audio.onpause = () => setPlayState(false);

        audio.ontimeupdate = () => {
            if (!audio.duration) return;
            const pct = (audio.currentTime / audio.duration) * 100;
            setScrubberFill(scrubber, pct);
            scrubber.value = pct;
            timeEl.textContent = `${fmt(audio.currentTime)} / ${fmt(audio.duration)}`;
        };

        audio.onloadedmetadata = () => {
            timeEl.textContent = `0:00 / ${fmt(audio.duration)}`;
        };

        audio.onended = () => {
            setPlayState(false);
            setScrubberFill(scrubber, 0);
            scrubber.value = 0;
            timeEl.textContent = `0:00 / ${fmt(audio.duration)}`;
        };

        scrubber.addEventListener('input', () => {
            if (!audio.duration) return;
            audio.currentTime = (scrubber.value / 100) * audio.duration;
            setScrubberFill(scrubber, +scrubber.value);
        });

        wrap._audio = audio;
        return wrap;
    };
})();
