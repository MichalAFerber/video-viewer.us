(function(){
  "use strict";
  var doc = document, root = doc.documentElement, body = doc.body;
  var empty      = doc.getElementById("empty");
  var stage      = doc.getElementById("stage");
  var player     = doc.getElementById("player");
  var metaLine   = doc.getElementById("metaLine");
  var notice     = doc.getElementById("notice");
  var noticeTitle= doc.getElementById("noticeTitle");
  var noticeBody = doc.getElementById("noticeBody");
  var fileInput  = doc.getElementById("fileInput");
  var overlay    = doc.getElementById("dropOverlay");
  var toastEl    = doc.getElementById("toast");
  var docTitle   = doc.getElementById("docTitle");
  var brandIcon  = doc.getElementById("brandIcon");
  (function(){ var fl = doc.querySelector('link[rel="icon"]'); if (brandIcon && fl) brandIcon.src = fl.href; })();
  var hoverZone  = doc.getElementById("hoverZone");
  var bgPicker   = doc.getElementById("bgPicker");
  var themeColor = doc.getElementById("themeColor");
  var btnFrame   = doc.getElementById("btnFrame");
  var btnLoop    = doc.getElementById("btnLoop");
  var btnSpeed   = doc.getElementById("btnSpeed");
  var btnPip     = doc.getElementById("btnPip");
  var btnSubs    = doc.getElementById("btnSubs");
  var toastTimer = null;
  var BASE_TITLE = "Video Viewer";
  var ACCEPT_EXT = { webm:1, mp4:1, m4v:1, ogv:1, mov:1, mkv:1 };   // this viewer's types ONLY (§8)
  var NOTICE_EXT = { avi:1, wmv:1 };   // accepted-with-notice: no native browser decoder

  var currentFile = null;   // the File being shown (metadata + copy info)
  var currentName = "";
  var currentUrl  = null;   // object URL for the <video> — revoked on replace and on Clear

  function toast(msg){
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ toastEl.classList.remove("show"); }, 1900);
  }

  function extOf(name){
    var m = /\.([A-Za-z0-9]+)$/.exec(name || "");
    return m ? m[1].toLowerCase() : "";
  }

  /* ---------- Opening a video ---------- */
  function readFile(file){
    if (!file) return;
    var ext = extOf(file.name);
    // §6.7 drop-to-replace, scoped exception: while a video is open, a .vtt/.srt
    // sidecar ATTACHES as subtitles instead of replacing the video. With no video
    // open the pair keeps the normal rejection path below (neither joins
    // ACCEPT_EXT or the family map — sidecars are contextual only).
    if ((ext === "vtt" || ext === "srt") && !stage.hidden && currentUrl){
      attachSubtitles(file);
      return;
    }
    if (NOTICE_EXT[ext]){ showLegacyNotice(file, ext); return; }
    if (!ACCEPT_EXT[ext]){
      // §6.10: offer the owning sibling viewer first; unmapped types keep the toast
      if (!familyRoute(file)) toast("“" + file.name + "” isn’t a supported video file");
      return;
    }
    openVideo(file);
  }

  function revokeCurrentUrl(){
    if (!currentUrl) return;
    try { URL.revokeObjectURL(currentUrl); } catch (e) {}
    currentUrl = null;
  }

  // Reflect the loaded file's name into the URL (?name=), so a bookmarked or
  // shared link says what was being viewed. history.replaceState only, and
  // URLSearchParams does its own percent-encoding — this never touches the
  // DOM, so it carries no XSS risk on its own. The value becomes untrusted
  // input again the moment it is read back (see the on-load block near the
  // bottom of this script), and that path must stay textContent-only.
  function syncQueryName(name){
    var url = new URL(location.href);
    if (name) url.searchParams.set("name", name);
    else url.searchParams.delete("name");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }

  function openVideo(file){
    revokeCurrentUrl();                       // drop-to-replace: free the previous object URL
    removeSubtitles();                        // …and the sidecar blob URL + track with it
    currentFile = file;
    currentName = file.name || "video";
    syncQueryName(currentName);
    metaLine.textContent = "";
    currentUrl = URL.createObjectURL(file);   // objectURL readMode — no FileReader for playback
    player.src = currentUrl;
    empty.hidden = true; notice.hidden = true; stage.hidden = false;
    btnFrame.hidden = false;
    btnLoop.hidden = false; btnSpeed.hidden = false;
    speedIdx = 1; applySpeed();               // rate resets to 1× per new file (never persisted)
    syncPip();
    setupMediaSession(currentName);
    docTitle.textContent = currentName;
    doc.title = currentName + " — " + BASE_TITLE;
    body.classList.add("viewing");
    lastScrollY = window.pageYOffset || 0;
    showHeader();                             // visible on open, then auto-hides after HEADER_TIMEOUT
    var p = player.play();
    if (p && p.catch) p.catch(function(){});  // autoplay may be blocked — the controls are right there
  }

  player.addEventListener("loadedmetadata", function(){
    if (!currentFile) return;
    var type = currentFile.type || (extOf(currentName) ? "video/" + extOf(currentName) : "video");
    metaLine.textContent = player.videoWidth + "×" + player.videoHeight + " · " +
      fmtDur(player.duration) + " · " + type + " · " + fmtSize(currentFile.size);
  });

  // Browser-dependent honesty: .mov/.mkv/HEVC-in-MP4 (and H.264 where absent) can
  // fail per browser — never a silent failure, always the hint card.
  player.addEventListener("error", function(){
    if (!currentUrl) return;                  // ignore the no-src error after Clear
    var name = currentName;
    revokeCurrentUrl();
    removeSubtitles();
    stage.hidden = true; btnFrame.hidden = true;
    btnLoop.hidden = true; btnSpeed.hidden = true; btnPip.hidden = true;
    clearTimeout(headerTimer); headerTimer = null;
    body.classList.remove("viewing", "peek");
    // ⁨…⁩ (FSI…PDI) bidi-isolate the untrusted name (same rule as the route card)
    noticeTitle.textContent = "Couldn’t play this video";
    noticeBody.textContent = "“⁨" + name + "⁩” loaded, but your browser couldn’t decode it. " +
      "Codec support varies by browser — .mov, .mkv, and HEVC/H.265 play in some browsers and not others. " +
      "Try a Chromium-based browser or Safari, or convert it to WebM or MP4 (H.264).";
    notice.hidden = false; empty.hidden = true;
  });

  function fmtDur(t){
    if (!isFinite(t) || t < 0) return "live";
    var s = Math.round(t), m = Math.floor(s / 60); s -= m * 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }
  function fmtSize(n){
    if (!(n >= 0)) return "";
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
    return (n / 1073741824).toFixed(2) + " GB";
  }

  /* ---------- Accept-with-notice: .avi / .wmv have no native decoder ---------- */
  function showLegacyNotice(file, ext){
    clearAll();
    currentName = file.name || "";
    syncQueryName(currentName);   // clearAll() just wiped it; the notice still names this file
    docTitle.textContent = currentName;
    doc.title = currentName + " — " + BASE_TITLE;
    noticeTitle.textContent = "No native decoder for ." + ext + " video";
    noticeBody.textContent = "“⁨" + file.name + "⁩” is a ." + ext + " file — browsers can’t decode it natively. " +
      "Convert it to MP4 (H.264) or WebM first — HandBrake (free) or " +
      "ffmpeg -i input." + ext + " output.mp4 — then drop it here again.";
    notice.hidden = false; empty.hidden = true;
  }

  /* ---------- Grab frame as PNG (local object URLs never taint the canvas) ---------- */
  btnFrame.addEventListener("click", function(){
    if (stage.hidden || !player.videoWidth){ toast("Nothing to capture yet"); return; }
    if (!player.paused) player.pause();
    var t = player.currentTime || 0, m = Math.floor(t / 60), s = Math.floor(t % 60);
    var canvas = doc.createElement("canvas");
    canvas.width = player.videoWidth; canvas.height = player.videoHeight;
    try { canvas.getContext("2d").drawImage(player, 0, 0); }
    catch (e){ toast("Couldn’t capture this frame"); return; }
    var base = currentName.replace(/\.[A-Za-z0-9]+$/, "") || "frame";
    canvas.toBlob(function(blob){
      if (!blob){ toast("Couldn’t capture this frame"); return; }
      var a = doc.createElement("a"), url = URL.createObjectURL(blob);
      a.href = url; a.download = base + "-" + m + "m" + s + "s.png";
      doc.body.appendChild(a); a.click(); doc.body.removeChild(a);
      setTimeout(function(){ try { URL.revokeObjectURL(url); } catch (e) {} }, 2000);
      toast("Frame saved");
    }, "image/png");
  });

  /* ---------- v2: frame-step while paused (,/. — pairs with grab-frame) ---------- */
  var FRAME_S = 1 / 30;
  function frameStep(dir){
    if (!player.paused) player.pause();       // stepping implies paused (documented in the hint)
    var t = player.currentTime + dir * FRAME_S;
    if (t < 0) t = 0;
    if (isFinite(player.duration) && t > player.duration) t = player.duration;
    player.currentTime = t;                   // native controls are the time display — they track this
  }

  /* ---------- v2: loop toggle (header iconbtn + L key) ---------- */
  function setLoop(on){
    player.loop = on;
    btnLoop.classList.toggle("active", on);
    btnLoop.setAttribute("aria-pressed", on ? "true" : "false");
  }
  btnLoop.addEventListener("click", function(){ setLoop(!player.loop); });

  /* ---------- v2: playback speed (cycles 0.75 → 1 → 1.25 → 1.5 → 2) ---------- */
  var SPEEDS = [0.75, 1, 1.25, 1.5, 2];
  var speedIdx = 1;
  function applySpeed(){
    var face = SPEEDS[speedIdx] + "×";
    player.playbackRate = SPEEDS[speedIdx];
    btnSpeed.textContent = face;
    btnSpeed.setAttribute("aria-label", "Playback speed: " + face);
  }
  btnSpeed.addEventListener("click", function(){
    speedIdx = (speedIdx + 1) % SPEEDS.length;
    applySpeed();
  });

  /* ---------- v2: Picture-in-Picture (hidden when the API isn't there) ---------- */
  var PIP_OK = !!doc.pictureInPictureEnabled;
  function syncPip(){
    btnPip.hidden = !PIP_OK || player.disablePictureInPicture === true || stage.hidden;
  }
  btnPip.addEventListener("click", function(){
    if (doc.pictureInPictureElement){
      try { doc.exitPictureInPicture(); } catch (e) {}
      return;
    }
    var p;
    try { p = player.requestPictureInPicture(); }
    catch (e){ toast("Picture-in-Picture isn’t available for this video"); return; }
    if (p && p.catch) p.catch(function(){ toast("Picture-in-Picture isn’t available for this video"); });
  });
  player.addEventListener("enterpictureinpicture", function(){
    btnPip.classList.add("active"); btnPip.setAttribute("aria-pressed", "true");
  });
  player.addEventListener("leavepictureinpicture", function(){
    btnPip.classList.remove("active"); btnPip.setAttribute("aria-pressed", "false");
  });

  /* ---------- v2: subtitle sidecars (.vtt/.srt attach while a video is open) ---------- */
  var subUrl = null;   // sidecar blob URL — revoked alongside the media URL on replace and Clear
  function setSubsUI(on){
    btnSubs.classList.toggle("active", on);
    btnSubs.setAttribute("aria-pressed", on ? "true" : "false");
  }
  function removeSubtitles(){
    var old = player.querySelector("track");
    if (old) player.removeChild(old);
    if (subUrl){ try { URL.revokeObjectURL(subUrl); } catch (e) {} subUrl = null; }
    btnSubs.hidden = true;
    setSubsUI(false);
  }
  // Original tiny SRT → WebVTT converter: strip cue-index lines, comma → dot in
  // timestamps, prepend the WEBVTT header. Handles \r\n and blank-line cue separation.
  function srtToVtt(text){
    var lines = String(text).replace(/^\uFEFF/, "").split(/\r?\n/);
    var out = ["WEBVTT", ""];
    for (var i = 0; i < lines.length; i++){
      var line = lines[i];
      if (/^\s*\d+\s*$/.test(line) && i + 1 < lines.length && lines[i + 1].indexOf("-->") !== -1) continue;
      if (line.indexOf("-->") !== -1) line = line.replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
      out.push(line);
    }
    return out.join("\n");
  }
  function attachSubtitles(file){
    var ext = extOf(file.name);
    var reader = new FileReader();
    reader.onload = function(){
      var vtt = ext === "srt" ? srtToVtt(reader.result) : String(reader.result);
      removeSubtitles();                      // one track at a time; the old blob URL is revoked
      subUrl = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));   // media-src blob: covers this
      var track = doc.createElement("track");
      track.kind = "subtitles";
      track.label = file.name;
      track.src = subUrl;
      track.setAttribute("default", "");
      player.appendChild(track);
      if (player.textTracks && player.textTracks.length) player.textTracks[0].mode = "showing";
      btnSubs.hidden = false;
      setSubsUI(true);
      toast("Subtitles attached — press c to toggle");
    };
    reader.onerror = function(){ toast("Couldn’t read the subtitle file"); };
    reader.readAsText(file);
  }
  function toggleSubs(){
    if (btnSubs.hidden || !player.textTracks || !player.textTracks.length) return;
    var on = player.textTracks[0].mode !== "showing";
    player.textTracks[0].mode = on ? "showing" : "hidden";
    setSubsUI(on);
  }
  btnSubs.addEventListener("click", toggleSubs);

  /* ---------- v2: Media Session (OS media keys + lock screens) ---------- */
  function setupMediaSession(name){
    if (!("mediaSession" in navigator)) return;
    try { navigator.mediaSession.metadata = new MediaMetadata({ title: name }); } catch (e) {}
    var handlers = {
      play:         function(){ var p = player.play(); if (p && p.catch) p.catch(function(){}); },
      pause:        function(){ player.pause(); },
      seekbackward: function(d){ seekBy(-((d && d.seekOffset) || 5)); },
      seekforward:  function(d){ seekBy((d && d.seekOffset) || 5); },
      seekto:       function(d){ if (d && typeof d.seekTime === "number" && isFinite(d.seekTime)) player.currentTime = d.seekTime; }
    };
    for (var k in handlers){
      try { navigator.mediaSession.setActionHandler(k, handlers[k]); } catch (e) {}
    }
  }

  /* ---------- v2: volume/mute persistence (fv-vol / fv-muted; loop & speed are NOT persisted) ---------- */
  try {
    var savedVol = parseFloat(localStorage.getItem("fv-vol"));
    if (isFinite(savedVol) && savedVol >= 0 && savedVol <= 1) player.volume = savedVol;
    var savedMuted = localStorage.getItem("fv-muted");
    if (savedMuted === "1") player.muted = true;
    else if (savedMuted === "0") player.muted = false;
  } catch (e) {}
  player.addEventListener("volumechange", function(){
    try {
      localStorage.setItem("fv-vol", String(player.volume));
      localStorage.setItem("fv-muted", player.muted ? "1" : "0");
    } catch (e) {}
  });

  /* ---------- Clearing ---------- */
  function clearAll(){
    currentFile = null; currentName = "";
    syncQueryName("");
    revokeCurrentUrl();
    removeSubtitles();                        // Clear revokes the sidecar blob URL too
    try { player.pause(); } catch (e) {}
    player.removeAttribute("src");
    player.load();
    metaLine.textContent = "";
    stage.hidden = true; notice.hidden = true; empty.hidden = false;
    btnFrame.hidden = true;
    btnLoop.hidden = true; btnSpeed.hidden = true; btnPip.hidden = true;
    docTitle.textContent = BASE_TITLE;
    doc.title = BASE_TITLE;
    clearTimeout(headerTimer); headerTimer = null;
    body.classList.remove("viewing", "peek");
  }

  function openDialog(){ fileInput.click(); }

  fileInput.addEventListener("change", function(e){
    var f = e.target.files && e.target.files[0];
    if (f) readFile(f);
    fileInput.value = "";
  });

  // Copy the video's info line (name, dimensions, duration, type, size)
  doc.getElementById("btnCopy").addEventListener("click", function(){
    var info = !stage.hidden && metaLine.textContent
      ? currentName + " — " + metaLine.textContent : "";
    if (!info){ toast("Nothing to copy yet"); return; }
    if (navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(info).then(
        function(){ toast("Video info copied"); },
        function(){ fallbackCopy(info); }
      );
    } else {
      fallbackCopy(info);
    }
  });
  function fallbackCopy(text){
    var ta = doc.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", "");
    ta.style.position = "fixed"; ta.style.opacity = "0";
    doc.body.appendChild(ta); ta.select();
    try { doc.execCommand("copy"); toast("Video info copied"); }
    catch (err){ toast("Copy not supported"); }
    doc.body.removeChild(ta);
  }

  doc.getElementById("btnClear").addEventListener("click", clearAll);

  // Hide the footer (far-right close button); it stays gone until reload
  doc.getElementById("btnFooterClose").addEventListener("click", function(){
    var f = doc.getElementById("footer");
    if (f) f.hidden = true;
  });

  // ---------- Family nav (hamburger flyout) ----------
  var btnMenu = doc.getElementById("btnMenu"), navBackdrop = doc.getElementById("navBackdrop");
  function setNav(open){
    body.classList.toggle("nav-open", open);
    btnMenu.setAttribute("aria-expanded", open ? "true" : "false");
  }
  btnMenu.addEventListener("click", function(){ setNav(!body.classList.contains("nav-open")); });
  navBackdrop.addEventListener("click", function(){ setNav(false); });
  doc.addEventListener("keydown", function(e){ if (e.key === "Escape") setNav(false); });

  // Empty-state acts as an open button (great on mobile)
  empty.addEventListener("click", openDialog);
  empty.addEventListener("keydown", function(e){
    if (e.key === "Enter" || e.key === " "){ e.preventDefault(); openDialog(); }
  });

  /* ---------- Auto-hiding header: show on open & on scroll up, collapse to the handle after 3 s ---------- */
  var HEADER_TIMEOUT = 3000;
  var headerTimer = null, lastScrollY = 0, headerHovered = false;
  var topbarEl = doc.querySelector(".topbar");

  function armHeaderTimer(){
    clearTimeout(headerTimer);
    headerTimer = setTimeout(function(){
      headerTimer = null;
      if (!headerHovered) body.classList.remove("peek");
    }, HEADER_TIMEOUT);
  }
  function showHeader(){
    if (!body.classList.contains("viewing")) return;
    body.classList.add("peek");
    armHeaderTimer();
  }
  function hideHeader(){
    clearTimeout(headerTimer); headerTimer = null;
    if (!headerHovered) body.classList.remove("peek");
  }

  window.addEventListener("scroll", function(){
    if (!body.classList.contains("viewing")) return;
    var y = window.pageYOffset || root.scrollTop || 0;
    if (y <= 0) showHeader();                     // at the very top, keep the header available
    else if (y < lastScrollY - 4) showHeader();   // scrolling up
    else if (y > lastScrollY + 4) hideHeader();   // scrolling down
    lastScrollY = y;
  }, { passive: true });

  // Don't let the timer yank the header away while the pointer is on it
  topbarEl.addEventListener("mouseenter", function(){ headerHovered = true; clearTimeout(headerTimer); headerTimer = null; });
  topbarEl.addEventListener("mouseleave", function(){ headerHovered = false; if (body.classList.contains("peek")) armHeaderTimer(); });

  // Reveal via the top strip / handle — hover, tap, or click (touch has no scroll-up-to-reveal)
  hoverZone.addEventListener("click", showHeader);
  hoverZone.addEventListener("mouseenter", showHeader);
  hoverZone.addEventListener("touchstart", function(){ showHeader(); }, { passive:true });

  /* ---------- Background color (chosen by the user, remembered in a cookie) ---------- */
  function setCookie(name, val){
    doc.cookie = name + "=" + encodeURIComponent(val) + "; max-age=31536000; path=/; SameSite=Lax";
  }
  function getCookie(name){
    var m = doc.cookie.match("(?:^|; )" + name.replace(/([.*+?^${}()|[\]\\])/g, "\\$1") + "=([^;]*)");
    return m ? decodeURIComponent(m[1]) : null;
  }
  function hexToRgb(h){
    h = h.replace("#", "");
    if (h.length === 3) h = h.charAt(0)+h.charAt(0)+h.charAt(1)+h.charAt(1)+h.charAt(2)+h.charAt(2);
    var n = parseInt(h, 16);
    return { r:(n>>16)&255, g:(n>>8)&255, b:n&255 };
  }
  function srgb(c){ c/=255; return c<=0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); }
  function luminance(rgb){ return 0.2126*srgb(rgb.r) + 0.7152*srgb(rgb.g) + 0.0722*srgb(rgb.b); }
  function mix(a, b, t){
    return "rgb(" + Math.round(a.r+(b.r-a.r)*t) + "," + Math.round(a.g+(b.g-a.g)*t) + "," + Math.round(a.b+(b.b-a.b)*t) + ")";
  }
  function rgbStr(c){ return "rgb(" + c.r + "," + c.g + "," + c.b + ")"; }

  function applyColor(hex){
    if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) hex = "#ffffff";
    var bg = hexToRgb(hex);
    // Pick black or white text by whichever contrasts better (crossover ~0.179).
    var lightText = luminance(bg) <= 0.179;          // dark background -> light text
    var text = lightText ? { r:240, g:243, b:246 } : { r:31, g:35, b:40 };
    var accentHex = lightText ? "#8b93ff" : "#4f46e5";
    var ac = hexToRgb(accentHex);
    var s = root.style;
    s.setProperty("--bg", hex);
    s.setProperty("--surface", hex);
    s.setProperty("--text", rgbStr(text));
    s.setProperty("--code-text", rgbStr(text));
    s.setProperty("--muted", mix(bg, text, 0.45));
    s.setProperty("--border", mix(bg, text, 0.24));
    s.setProperty("--border-soft", mix(bg, text, 0.13));
    s.setProperty("--code-bg", mix(bg, text, 0.07));
    s.setProperty("--hover", mix(bg, text, 0.10));
    s.setProperty("--accent", accentHex);
    s.setProperty("--accent-contrast", lightText ? "#0d1117" : "#ffffff");
    s.setProperty("--overlay", "rgba(" + ac.r + "," + ac.g + "," + ac.b + ",0.12)");
    s.setProperty("--shadow", lightText ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.12)");
    s.setProperty("--header-bg", "rgba(" + bg.r + "," + bg.g + "," + bg.b + ",0.9)");
    s.colorScheme = lightText ? "dark" : "light";
    themeColor.setAttribute("content", hex);
  }

  function isHex6(v){ return /^#([0-9a-f]{6})$/i.test(v || ""); }
  function saveColor(val){
    setCookie("mykk-bg", val);                                  // primary
    try { localStorage.setItem("mykk-bg", val); } catch (e) {}  // fallback (e.g. file://)
  }
  function loadColor(){
    var v = getCookie("mykk-bg");
    if (!isHex6(v)) { try { v = localStorage.getItem("mykk-bg"); } catch (e) { v = null; } }
    return isHex6(v) ? v : ((window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches) ? "#0d1117" : "#ffffff");
  }

  var themeToggle=document.getElementById("themeToggle"),themeIconSun=document.getElementById("themeIconSun"),themeIconMoon=document.getElementById("themeIconMoon");
  var saved = loadColor();
  bgPicker.value = saved;
  applyColor(saved);
  syncThemeToggle();
  bgPicker.addEventListener("input", function(){
    applyColor(bgPicker.value);
    saveColor(bgPicker.value);
    syncThemeToggle();
  });
  function isDarkBg(){ try { return luminance(hexToRgb(bgPicker.value)) <= 0.179; } catch(e){ return false; } }
  function syncThemeToggle(){ if(!themeToggle) return; var dark=isDarkBg(); themeToggle.setAttribute("aria-pressed", dark?"true":"false"); themeToggle.setAttribute("aria-label", dark?"Switch to light theme":"Switch to dark theme"); if(themeIconSun){ if(dark) themeIconSun.setAttribute("hidden",""); else themeIconSun.removeAttribute("hidden"); } if(themeIconMoon){ if(dark) themeIconMoon.removeAttribute("hidden"); else themeIconMoon.setAttribute("hidden",""); } }
  if(themeToggle){ themeToggle.addEventListener("click", function(){ var next=isDarkBg()?"#ffffff":"#0d1117"; bgPicker.value=next; applyColor(next); saveColor(next); syncThemeToggle(); }); }

  /* ---------- Drag & drop (anywhere — dropping a new file replaces the open one) ---------- */
  var dragDepth = 0;
  function showOverlay(s){ overlay.classList.toggle("show", s); }
  window.addEventListener("dragenter", function(e){
    if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") === -1) return;
    e.preventDefault(); dragDepth++; showOverlay(true);
  });
  window.addEventListener("dragover", function(e){
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  });
  window.addEventListener("dragleave", function(e){
    e.preventDefault(); dragDepth--; if (dragDepth <= 0){ dragDepth = 0; showOverlay(false); }
  });
  window.addEventListener("drop", function(e){
    e.preventDefault(); dragDepth = 0; showOverlay(false);
    var dt = e.dataTransfer; if (!dt) return;
    if (dt.files && dt.files.length) readFile(dt.files[0]);
  });

  /* ---------- Paste a file to open it ---------- */
  window.addEventListener("paste", function(e){
    var cd = e.clipboardData || window.clipboardData;
    if (cd && cd.files && cd.files.length){ e.preventDefault(); readFile(cd.files[0]); }
  });

  /* ---------- Keyboard: §6.10 modal first, then playback shortcuts (while viewing) ---------- */
  window.addEventListener("keydown", function(e){
    if (!id("routeCard").hidden){                       // §6.10 offer card is modal
      if (e.key === "Escape"){ hideRouteCard(); return; }
      if (e.key === "Tab"){                             // two-button focus wrap (aria-modal)
        e.preventDefault();
        var go = id("routeGo"), no = id("routeDismiss");
        (doc.activeElement === go || go.disabled ? no : go).focus();
      }
      return;                                           // nothing else acts beneath the dialog
    }
    if (body.classList.contains("nav-open")) return;    // flyout nav owns the keyboard while open
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (!body.classList.contains("viewing") || stage.hidden) return;
    var t = e.target, tag = (t && t.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || (t && t.isContentEditable)) return;
    if (t === player) return;   // the native controls handle keys on the element itself
    var k = e.key;
    if (k === " " || k === "Spacebar"){
      e.preventDefault();
      if (player.paused){ var p = player.play(); if (p && p.catch) p.catch(function(){}); }
      else player.pause();
    }
    else if (k === "ArrowRight"){ e.preventDefault(); seekBy(5); }
    else if (k === "ArrowLeft"){ e.preventDefault(); seekBy(-5); }
    else if (k === "ArrowUp"){ e.preventDefault(); player.volume = Math.min(1, Math.round((player.volume + 0.1) * 10) / 10); player.muted = false; }
    else if (k === "ArrowDown"){ e.preventDefault(); player.volume = Math.max(0, Math.round((player.volume - 0.1) * 10) / 10); }
    else if (k === "m" || k === "M"){ player.muted = !player.muted; }
    else if (k === "f" || k === "F"){ toggleFullscreen(); }
    else if (k === "."){ e.preventDefault(); frameStep(1); }    // frame step pauses first if playing
    else if (k === ","){ e.preventDefault(); frameStep(-1); }
    else if (k === "l" || k === "L"){ setLoop(!player.loop); }
    else if (k === "c" || k === "C"){ toggleSubs(); }
  });
  function seekBy(d){
    if (!isFinite(player.duration)) return;
    player.currentTime = Math.max(0, Math.min(player.duration, player.currentTime + d));
  }
  function toggleFullscreen(){
    var fsEl = doc.fullscreenElement || doc.webkitFullscreenElement;
    if (fsEl){
      try { (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc); } catch (e) {}
      return;
    }
    var el = stage;   // fullscreen the stage wrapper, not the bare element
    var req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) try { req.call(el); } catch (e) {}
  }

  // ---------- Family router (§6.10): wrong-viewer redirect offer + in-browser hand-off ----------
  // Data block generated from family-map.json (canonical, hub repo); deep-equality
  // is enforced by the harness (§6.10 governance).
  function id(s){ return doc.getElementById(s); }
    /* FV-MAP-START — generated from family-map.json (canonical); deep-equality enforced by the harness */
    var FAMILY = {
      audio:    { domain:"audio-viewer.us"     , label:"Audio Viewer"     , kind:"an audio file" },
      cert:     { domain:"cert-viewer.us"      , label:"Cert Viewer"      , kind:"a certificate" },
      data:     { domain:"data-viewer.us"      , label:"Data Viewer"      , kind:"a data file" },
      docx:     { domain:"docx-viewer.us"      , label:"DOCX Viewer"      , kind:"a Word document" },
      eml:      { domain:"eml-viewer.us"       , label:"EML Viewer"       , kind:"an email file" },
      epub:     { domain:"epub-viewer.us"      , label:"EPUB Viewer"      , kind:"an e-book" },
      html:     { domain:"html-viewer.us"      , label:"HTML Viewer"      , kind:"a web or source-code file" },
      image:    { domain:"image-viewer.us"     , label:"Image Viewer"     , kind:"an image" },
      log:      { domain:"log-viewer.us"       , label:"Log Viewer"       , kind:"a log file" },
      markdown: { domain:"markdown-viewer.us"  , label:"Markdown Viewer"  , kind:"a Markdown or text file" },
      pdf:      { domain:"pdf-viewer.us"       , label:"PDF Viewer"       , kind:"a PDF" },
      pptx:     { domain:"pptx-viewer.us"      , label:"PPTX Viewer"      , kind:"a presentation" },
      pub:      { domain:"pub-viewer.us"       , label:"PUB Viewer"       , kind:"a Publisher file" },
      sheets:   { domain:"sheets-viewer.us"    , label:"Sheets Viewer"    , kind:"a spreadsheet" },
      video:    { domain:"video-viewer.us"     , label:"Video Viewer"     , kind:"a video" }
    };
    var FAMILY_HUB = "file-viewer.us";
    var FAMILY_NAMES = {"robots.txt":"html"};
    var FAMILY_MAP = {
      // sheets
      "123":"sheets", xlsx:"sheets", xlsm:"sheets", xlsb:"sheets", xls:"sheets", xlt:"sheets", xltx:"sheets", xltm:"sheets",
      xlam:"sheets", ods:"sheets", fods:"sheets", dif:"sheets", prn:"sheets", dbf:"sheets", numbers:"sheets", xlml:"sheets",
      wk1:"sheets", wk3:"sheets", wks:"sheets", et:"sheets", uos:"sheets",
      // cert
      pem:"cert", crt:"cert", cer:"cert", der:"cert", csr:"cert", cert:"cert", p7b:"cert", p12:"cert",
      pfx:"cert",
      // data
      json:"data", jsonc:"data", json5:"data", jsonld:"data", ndjson:"data", yaml:"data", yml:"data", toml:"data",
      csv:"data", tsv:"data", xml:"data", rss:"data", atom:"data", graphql:"data", gql:"data",
      // docx
      docx:"docx", docm:"docx", dotx:"docx", dotm:"docx", doc:"docx", dot:"docx", rtf:"docx", odt:"docx",
      // eml
      eml:"eml", mbox:"eml", emlx:"eml", msg:"eml",
      // epub
      epub:"epub",
      // html
      html:"html", htm:"html", xhtml:"html", xht:"html", shtml:"html", shtm:"html", stm:"html", hta:"html",
      mhtml:"html", mht:"html", css:"html", scss:"html", sass:"html", less:"html", styl:"html", pcss:"html",
      postcss:"html", js:"html", mjs:"html", cjs:"html", jsx:"html", ts:"html", mts:"html", cts:"html",
      tsx:"html", coffee:"html", htaccess:"html", htpasswd:"html", env:"html", ini:"html", conf:"html", webmanifest:"html",
      map:"html", php:"html", phtml:"html", asp:"html", aspx:"html", ascx:"html", cshtml:"html", vbhtml:"html",
      jsp:"html", jspx:"html", cfm:"html", erb:"html", rhtml:"html", ejs:"html", hbs:"html", handlebars:"html",
      mustache:"html", njk:"html", liquid:"html", jinja:"html", j2:"html", twig:"html", pug:"html", jade:"html",
      haml:"html", slim:"html", vue:"html", svelte:"html", astro:"html",
      // image
      png:"image", jpg:"image", jpeg:"image", jpe:"image", jfif:"image", gif:"image", webp:"image", avif:"image",
      svg:"image", svgz:"image", bmp:"image", dib:"image", ico:"image", cur:"image", tif:"image", tiff:"image",
      tga:"image", targa:"image", icb:"image", vda:"image", vst:"image", qoi:"image", pcx:"image", ppm:"image",
      pgm:"image", pbm:"image", pnm:"image", pam:"image", ff:"image", dds:"image", heic:"image", heif:"image",
      jxl:"image", psd:"image",
      // log
      log:"log", out:"log", err:"log", trace:"log", syslog:"log",
      // markdown
      md:"markdown", markdown:"markdown", mdx:"markdown", txt:"markdown", rst:"markdown", adoc:"markdown",
      // pdf
      pdf:"pdf",
      // pptx
      pptx:"pptx", pptm:"pptx", ppsx:"pptx", ppsm:"pptx", potx:"pptx", potm:"pptx", ppt:"pptx",
      // pub
      pub:"pub",
      // audio
      mp3:"audio", wav:"audio", flac:"audio", m4a:"audio", aac:"audio", ogg:"audio", oga:"audio", opus:"audio",
      weba:"audio", mka:"audio", aif:"audio", aiff:"audio", wma:"audio", mid:"audio", midi:"audio",
      // video
      webm:"video", mp4:"video", m4v:"video", ogv:"video", mov:"video", mkv:"video", avi:"video", wmv:"video"
    };
    /* FV-MAP-END */
    var FAMILY_ORIGINS = Object.keys(FAMILY).map(function (k) { return "https://" + FAMILY[k].domain; })
      .concat("https://" + FAMILY_HUB);
  var DOMAIN = "video-viewer.us";

  var routeFile = null, routeKey = "", routePrevFocus = null, handoff = null;
  function cancelHandoff(){                    // tear down a pending hand-off (sender below)
    if (!handoff) return;
    window.removeEventListener("message", handoff.onMsg);
    clearTimeout(handoff.timer);
    handoff = null;
  }
  function showRouteCard(file, key){
    cancelHandoff();                           // a new offer aborts any pending hand-off
    if (id("routeCard").hidden) routePrevFocus = doc.activeElement;  // don't capture our own button
    routeFile = file; routeKey = key;
    var t = FAMILY[key];
    // ⁨…⁩ (FSI…PDI) bidi-isolate the untrusted name so U+202E-style
    // overrides can't visually reorder the sentence.
    id("routeMsg").textContent = "“⁨" + file.name + "⁩” looks like " + t.kind + " — it belongs to " + t.label + ".";
    id("routeGo").textContent = "Open " + t.domain + " ↗";
    id("routeSub").textContent = "Your file stays on this device — nothing is uploaded.";
    id("routeGo").disabled = false;
    id("routeBackdrop").hidden = false; id("routeCard").hidden = false;
    id("routeGo").focus();
  }
  function hideRouteCard(){
    cancelHandoff();                           // dismissal aborts a pending hand-off
    id("routeBackdrop").hidden = true; id("routeCard").hidden = true;
    routeFile = null; routeKey = "";
    if (routePrevFocus && routePrevFocus.focus) routePrevFocus.focus();
  }
  function familyRoute(file){
    var n = String(file && file.name || "").toLowerCase();
    var key = FAMILY_NAMES[n];
    if (!key){
      var i = n.lastIndexOf(".");
      var ext = i >= 0 ? n.slice(i + 1) : "";
      key = FAMILY_MAP[ext];
    }
    if (!key || FAMILY[key].domain === DOMAIN) return false;  // unknown type, or our own → caller keeps its toast
    showRouteCard(file, key);
    return true;
  }

  // Sender — routeGo is a real user gesture, so no popup blocker. Keep the window
  // handle: it is the message channel (no `noopener` on this one window.open).
  id("routeGo").addEventListener("click", function(){
    if (!routeFile || id("routeGo").disabled) return;               // no double-fire
    cancelHandoff();
    var t = FAMILY[routeKey], origin = "https://" + t.domain, file = routeFile;
    var w = window.open(origin + "/#fvh=" + encodeURIComponent(file.name));
    if (!w){ id("routeSub").textContent = "Couldn’t open the tab — allow pop-ups for this site and try again."; return; }
    id("routeGo").disabled = true;
    var h = {};
    h.onMsg = function(e){
      if (e.source !== w || e.origin !== origin || !e.data) return;
      if (e.data.type === "fv-ready") w.postMessage({ type:"fv-file", file:file }, origin);
      else if (e.data.type === "fv-ack"){ hideRouteCard(); toast("Sent to " + t.label); }  // hideRouteCard tears the handshake down
    };
    h.timer = setTimeout(function(){
      if (handoff !== h) return;
      cancelHandoff();
      id("routeSub").textContent = "Tab opened — drop the file there.";   // Level-1 fallback
    }, 10000);
    handoff = h;
    window.addEventListener("message", h.onMsg);
  });
  id("routeDismiss").addEventListener("click", hideRouteCard);
  id("routeBackdrop").addEventListener("click", hideRouteCard);

  // Receiver — accept a File handed over from a sibling family tab (§6.10).
  window.addEventListener("message", function(e){
    if (FAMILY_ORIGINS.indexOf(e.origin) === -1) return;      // family origins only
    var d = e.data;
    if (d && d.type === "fv-file" && d.file instanceof File){ // clone re-creates a real File in this realm
      readFile(d.file);
      e.source.postMessage({ type:"fv-ack" }, e.origin);      // ack = received and handed to the loader
    }
  });
  var fvh = /[#&]fvh=([^&]*)/.exec(location.hash);
  if (fvh){
    var fvhName = fvh[1];                                   // ⚠️ stranger-controlled — textContent only
    try { fvhName = decodeURIComponent(fvhName); } catch (_) {}  // malformed %-escapes must not abort the receiver
    history.replaceState(null, "", location.pathname + location.search);  // always clear, opener or not
    if (window.opener){
      try { window.opener.postMessage({ type:"fv-ready" }, "*"); } catch(_){}
      window.opener = null;    // sever the reverse-navigation channel once the ping is out
      var emptySub = doc.querySelector(".empty-sub");         // hand-off pending: say so in the empty state
      if (emptySub){
        var emptySubCopy = emptySub.textContent;
        emptySub.textContent = "Receiving “⁨" + fvhName + "⁩”…";  // FSI…PDI isolate the untrusted name
        setTimeout(function(){ emptySub.textContent = emptySubCopy; }, 10000);  // revert if nothing arrives
      }
    }
  }

  // A bookmarked or shared link can carry the name of the file last viewed
  // (?name=, set by syncQueryName above). No content is ever recoverable
  // from a name alone -- this only labels the empty state, and it never
  // fetches or renders anything on the strength of it. Skipped when an
  // #fvh hand-off is already customizing the same element.
  if (!fvh && !currentName){
    var qName = new URLSearchParams(location.search).get("name");
    if (qName){
      var lastSub = doc.querySelector(".empty-sub");
      if (lastSub){
        // Display-only, and it must stay that way: this string is read
        // straight from the URL, so it is exactly as stranger-controlled as
        // fvhName above. No fact is asserted about whether anyone actually
        // viewed it -- only that the link names it.
        lastSub.textContent = "This link was shared for “⁨" + qName + "⁩”.";
      }
    }
  }
})();
