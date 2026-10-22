(function () {
  "use strict";

  let audioContext = null;
  const scanCharacterSource = new URL("일러스트/megane_hikaru_man.png", document.baseURI).href;
  const scanCharacterPreload = new Image();
  scanCharacterPreload.src = scanCharacterSource;

  function playPang() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      audioContext = audioContext || new AudioContext();
      if (audioContext.state === "suspended") audioContext.resume();

      const now = audioContext.currentTime;
      const master = audioContext.createGain();
      master.gain.setValueAtTime(0.22, now);
      master.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      master.connect(audioContext.destination);

      const oscillator = audioContext.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(210, now);
      oscillator.frequency.exponentialRampToValueAtTime(72, now + 0.14);
      oscillator.connect(master);
      oscillator.start(now);
      oscillator.stop(now + 0.16);

      const noiseLength = Math.floor(audioContext.sampleRate * 0.12);
      const buffer = audioContext.createBuffer(1, noiseLength, audioContext.sampleRate);
      const channel = buffer.getChannelData(0);
      for (let index = 0; index < noiseLength; index += 1) {
        const decay = 1 - index / noiseLength;
        channel[index] = (Math.random() * 2 - 1) * decay * decay;
      }
      const noise = audioContext.createBufferSource();
      const noiseGain = audioContext.createGain();
      const filter = audioContext.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 850;
      filter.Q.value = 0.7;
      noise.buffer = buffer;
      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(audioContext.destination);
      noiseGain.gain.setValueAtTime(0.17, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      noise.start(now);
    } catch (_) {
      // 오디오를 허용하지 않는 브라우저에서는 애니메이션만 실행한다.
    }
  }

  function burstDocuments(button) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rect = button.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const colors = ["#fffdf9", "#f4d9d7", "#eadbea", "#dcebe8"];

    for (let index = 0; index < 16; index += 1) {
      const paper = document.createElement("span");
      paper.className = "paper-burst-piece" + (index % 4 === 0 ? " stamp" : "");
      paper.style.left = centerX + "px";
      paper.style.top = centerY + "px";
      paper.style.backgroundColor = colors[index % colors.length];
      paper.style.width = 24 + Math.random() * 14 + "px";
      paper.style.height = 32 + Math.random() * 18 + "px";
      document.body.appendChild(paper);

      // 버튼 위에서 부드럽게 좌우로 흩어진 뒤 아래로 떨어진다.
      const spread = (index - 7.5) / 7.5;
      const endX = spread * (150 + Math.random() * 90) + (Math.random() - 0.5) * 45;
      const peakX = endX * 0.35 + (Math.random() - 0.5) * 30;
      const peakY = -(75 + Math.random() * 105);
      const driftX = endX * 0.72 + (Math.random() - 0.5) * 45;
      const endY = 300 + Math.random() * 220;
      const rotation = (Math.random() - 0.5) * 620;
      const duration = 1900 + Math.random() * 900;
      const delay = Math.random() * 140;

      const animation = paper.animate(
        [
          { transform: "translate(-50%, -50%) scale(.55) rotate(0deg)", opacity: 0 },
          { transform: `translate(calc(-50% + ${peakX * 0.35}px), calc(-50% + ${peakY * 0.45}px)) scale(1.03) rotate(${rotation * 0.12}deg)`, opacity: 1, offset: 0.10 },
          { transform: `translate(calc(-50% + ${peakX}px), calc(-50% + ${peakY}px)) scale(1) rotate(${rotation * 0.32}deg)`, opacity: 1, offset: 0.30 },
          { transform: `translate(calc(-50% + ${driftX}px), calc(-50% + ${endY * 0.48}px)) scale(.96) rotate(${rotation * 0.68}deg)`, opacity: 1, offset: 0.72 },
          { transform: `translate(calc(-50% + ${endX}px), calc(-50% + ${endY * 0.82}px)) scale(.92) rotate(${rotation * 0.87}deg)`, opacity: .82, offset: 0.90 },
          { transform: `translate(calc(-50% + ${endX}px), calc(-50% + ${endY}px)) scale(.88) rotate(${rotation}deg)`, opacity: 0 },
        ],
        { duration, delay, easing: "cubic-bezier(.18,.58,.3,1)", fill: "forwards" }
      );
      animation.onfinish = () => paper.remove();
    }
  }

  async function showScanCharacter(button) {
    const previous = button.querySelector(".scan-character-effect");
    if (previous) previous.remove();

    const character = document.createElement("img");
    character.className = "scan-character-effect";
    character.src = scanCharacterSource;
    character.style.visibility = "hidden";
    character.alt = "";
    character.setAttribute("aria-hidden", "true");
    character.draggable = false;
    button.appendChild(character);

    try {
      await character.decode();
    } catch (_) {
      character.remove();
      button.dispatchEvent(new CustomEvent("scan-character-ready", { bubbles: true }));
      return;
    }
    if (!character.isConnected) return;
    character.style.visibility = "visible";

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animation = character.animate(
      reducedMotion
        ? [{ opacity: 1 }, { opacity: 1, offset: 0.65 }, { opacity: 0 }]
        : [
          { opacity: 1, transform: "translateX(-50%) translateY(4px) scale(.8)" },
          { opacity: 1, transform: "translateX(-50%) translateY(0) scale(.95)", offset: 0.12 },
          { opacity: 1, transform: "translateX(-50%) translateY(-12px) scale(1)", offset: 0.55 },
          { opacity: .85, transform: "translateX(-50%) translateY(-20px) scale(1.08)", offset: 0.75 },
          { opacity: 0, transform: "translateX(-50%) translateY(-32px) scale(1.16)" },
        ],
      { duration: 1500, easing: "ease-out", fill: "both" }
    );
    animation.onfinish = () => character.remove();
    animation.oncancel = () => character.remove();
    button.dispatchEvent(new CustomEvent("scan-character-ready", { bubbles: true }));
  }

  document.addEventListener("click", function (event) {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    if (button.id === "scanButton") showScanCharacter(button);
    burstDocuments(button);
    playPang();
  }, true);

  const ruleHelp = document.getElementById("ruleHelp");
  const ruleHelpButton = document.getElementById("ruleHelpButton");
  const ruleHelpPopup = document.getElementById("ruleHelpPopup");
  let closeTimer = null;

  function openRuleHelp() {
    if (!ruleHelpPopup) return;
    clearTimeout(closeTimer);
    ruleHelpPopup.hidden = false;
    ruleHelpButton.setAttribute("aria-expanded", "true");
  }

  function closeRuleHelp(delay) {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(function () {
      ruleHelpPopup.hidden = true;
      ruleHelpButton.setAttribute("aria-expanded", "false");
    }, delay || 0);
  }

  if (ruleHelp && ruleHelpButton && ruleHelpPopup) {
    ruleHelp.addEventListener("mouseenter", openRuleHelp);
    ruleHelp.addEventListener("mouseleave", function () { closeRuleHelp(100); });
    ruleHelp.addEventListener("focusin", openRuleHelp);
    ruleHelp.addEventListener("focusout", function (event) {
      if (!ruleHelp.contains(event.relatedTarget)) closeRuleHelp(0);
    });
    ruleHelpButton.addEventListener("click", function (event) {
      event.stopPropagation();
      if (ruleHelpPopup.hidden) openRuleHelp();
      else closeRuleHelp(0);
    });
    document.addEventListener("pointerover", function (event) {
      if (!ruleHelp.contains(event.target)) closeRuleHelp(0);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeRuleHelp(0);
    });
  }
})();
