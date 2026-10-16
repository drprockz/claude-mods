#!/usr/bin/env bash
# Claude Code status line v9 — instrument panel (truecolor, single-width glyphs).
#
#   ✦ Opus 5.5   ●●●○○ high        $ $18.43 session · $1,500 Oct   ◴ 4h 31m
#   ◔ Context    ▰▰▰▰▰▱▱▱▱▱   46%   458k of 1M tokens
#   ◷ 5-hour     ▰▰▰▰◆▱▱▱▱▱   45%   resets tomorrow 1:50 AM · in 3h 56m
#   ▦ 7-day      ▰▰▰▰◆▰▰▱▱▱   68%   resets Wed 14 Oct, 2:30 PM · in 4d 16h
#
# Each pill is 10%, lit in the colour of its position on one shared heat
# scale (mint < 70%, amber < 90%, coral beyond). The pill at even pace for
# the window is a diamond: ◆ when usage has reached it, ◇ when it hasn't.
export LC_ALL=${LC_ALL:-en_US.UTF-8}

# macOS (BSD) and Linux (GNU) spell stat and date differently
if date --version >/dev/null 2>&1; then
  mtime() { stat -c %Y "$1" 2>/dev/null; }
  btime() { local b; b=$(stat -c %W "$1" 2>/dev/null); [ "${b:-0}" -gt 0 ] 2>/dev/null && printf '%s' "$b"; }
  dfmt() { local s=$1; shift; date -d "@$s" "$@"; }
  iso_epoch() { date -u -d "$1" +%s 2>/dev/null; }
else
  mtime() { stat -f %m "$1" 2>/dev/null; }
  btime() { stat -f %B "$1" 2>/dev/null; }
  dfmt() { local s=$1; shift; date -r "$s" "$@"; }
  iso_epoch() { date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$1" +%s 2>/dev/null; }
fi

ESC=$'\033'; R="${ESC}[0m"; B="${ESC}[1m"
tc() { printf '%s[38;2;%s;%s;%sm' "$ESC" "$1" "$2" "$3"; }
bg() { printf '%s[48;2;%s;%s;%sm' "$ESC" "$1" "$2" "$3"; }
DIM=$(tc 164 172 196); FG=$(tc 230 233 245); FAINT=$(tc 90 97 124)
IDENT_RGB='190 172 255'; IDENT=$(tc $IDENT_RGB)
OK=$(tc 125 216 160); WATCH=$(tc 245 196 105); HOT=$(tc 245 125 120); MONEY=$(tc 240 184 92)
C_CTX=$(tc 247 168 120); C_5H=$(tc 120 196 250); C_7D=$(tc 236 150 200)

fmt_dur() { local s=${1:-0}; [ "$s" -le 0 ] 2>/dev/null && { printf '—'; return; }
  local d=$((s/86400)) h=$(((s%86400)/3600)) m=$(((s%3600)/60))
  if [ "$d" -gt 0 ]; then printf '%dd %dh' "$d" "$h"
  elif [ "$h" -gt 0 ]; then printf '%dh %dm' "$h" "$m"; else printf '%dm' "$m"; fi; }
fmt_tok() { awk -v n="${1:-0}" 'BEGIN{ if(n>=1000000){ s=sprintf("%.1f",n/1000000); sub(/\.0$/,"",s); printf"%sM",s } else if(n>=10000)printf"%dk",int(n/1000+0.5); else if(n>=1000)printf"%.1fk",n/1000; else printf"%d",n }'; }
epoch() { case "$1" in '') ;; *[!0-9]*) iso_epoch "$1";; *) printf '%s' "$1";; esac; }
# display width: ANSI stripped, wide (emoji/CJK) characters count twice
vlen() { printf '%s' "$1" | perl -CS -0777 -ne 's/\e\[[0-9;]*m//g; print length($_) + (() = /[\p{EA=W}\p{EA=F}]/g)'; }
pad() { local s=$1 w=$2 n; n=$(vlen "$s"); printf '%s%*s' "$s" $(( w>n ? w-n : 0 )) ''; }

J=$(cat)

# Field reader for the status line JSON, done in awk (already a dependency,
# see pills()/fmt_tok() below) instead of jq so a bare Windows/Git-Bash
# machine without jq installed still gets a working status line. Each value
# comes back as a single-quoted, eval-safe shell token.
json_fields() {
  awk '
    function find_obj(json, key,    i, n, c, instr, esc, depth, start, pat) {
      pat = "\"" key "\"[ \t\r\n]*:[ \t\r\n]*\\{"
      if (!match(json, pat)) return ""
      start = RSTART + RLENGTH - 1
      depth = 0; instr = 0; esc = 0; n = length(json)
      for (i = start; i <= n; i++) {
        c = substr(json, i, 1)
        if (esc) { esc = 0; continue }
        if (c == "\\") { esc = 1; continue }
        if (c == "\"") { instr = !instr; continue }
        if (instr) continue
        if (c == "{") depth++
        else if (c == "}") { depth--; if (depth == 0) return substr(json, start, i - start + 1) }
      }
      return ""
    }
    function find_str(json, key,    pat, s) {
      pat = "\"" key "\"[ \t\r\n]*:[ \t\r\n]*\"([^\"\\\\]|\\\\.)*\""
      if (!match(json, pat)) return ""
      s = substr(json, RSTART, RLENGTH)
      sub(/^[^:]*:[ \t\r\n]*"/, "", s); sub(/"$/, "", s)
      gsub(/\\"/, "\"", s)
      return s
    }
    function find_num(json, key,    pat, s) {
      pat = "\"" key "\"[ \t\r\n]*:[ \t\r\n]*(-?[0-9]+(\\.[0-9]+)?([eE][+-]?[0-9]+)?|null)"
      if (!match(json, pat)) return ""
      s = substr(json, RSTART, RLENGTH)
      sub(/^[^:]*:[ \t\r\n]*/, "", s)
      return s == "null" ? "" : s
    }
    function shq(v,    out, i, n, c) {
      out = "\x27"
      n = length(v)
      for (i = 1; i <= n; i++) {
        c = substr(v, i, 1)
        out = out (c == "\x27" ? "\x27\\\x27\x27" : c)
      }
      return out "\x27"
    }
    {
      j = $0
      cw = find_obj(j, "context_window"); cu = find_obj(cw, "current_usage")
      rl = find_obj(j, "rate_limits"); fh = find_obj(rl, "five_hour"); sd = find_obj(rl, "seven_day")
      md = find_obj(j, "model"); ef = find_obj(j, "effort"); co = find_obj(j, "cost")
      printf "MODEL=%s\n", shq(find_str(md, "display_name"))
      printf "EFFORT=%s\n", shq(find_str(ef, "level"))
      printf "CTX_PCT=%s\n", shq(find_num(cw, "used_percentage"))
      printf "CTX_SIZE=%s\n", shq(find_num(cw, "context_window_size"))
      printf "CTX_IN=%s\n", shq(find_num(cu, "input_tokens"))
      printf "CTX_OUT=%s\n", shq(find_num(cu, "output_tokens"))
      printf "CTX_CC=%s\n", shq(find_num(cu, "cache_creation_input_tokens"))
      printf "CTX_CR=%s\n", shq(find_num(cu, "cache_read_input_tokens"))
      printf "H_PCT=%s\n", shq(find_num(fh, "used_percentage"))
      printf "H_RST=%s\n", shq(find_str(fh, "resets_at"))
      printf "D_PCT=%s\n", shq(find_num(sd, "used_percentage"))
      printf "D_RST=%s\n", shq(find_str(sd, "resets_at"))
      printf "COST=%s\n", shq(find_num(co, "total_cost_usd"))
      printf "TRANSCRIPT=%s\n", shq(find_str(j, "transcript_path"))
    }
  ' <<<"$J"
}
eval "$(json_fields)"
MODEL=${MODEL:-Claude}; MODEL=${MODEL/ (1M context)/}
CTX_PCT=${CTX_PCT:-0}
CTX_SIZE=${CTX_SIZE:-1000000}
CTX_NOW=$(( ${CTX_IN:-0} + ${CTX_OUT:-0} + ${CTX_CC:-0} + ${CTX_CR:-0} ))
now=$(date +%s)

# --- CRUZ quota cache -------------------------------------------------------
# services/claude_quota.py reads ~/.claude/cruz-rate-limits.json to decide
# whether it is safe to open a NEW Claude Code terminal session against the
# shared Max quota. It refuses when the cache is missing or older than 30
# minutes, so without this write FORGE/QT/MARK/SENTINEL sessions never start.
# It lives here because ONLY a genuinely interactive session fires the
# statusline — a headless `claude -p` never does.
# Best-effort and entirely non-fatal: written atomically via mktemp+mv so a
# reader never sees a partial file, and every failure path leaves the previous
# cache untouched without affecting the status line.
{
  _cq="$HOME/.claude/cruz-rate-limits.json"
  _esc() { local s=${1//\\/\\\\}; printf '%s' "${s//\"/\\\"}"; }
  if _tmp=$(mktemp "${_cq}.XXXXXX" 2>/dev/null); then
    _body='{"updated_at":"'"$(_esc "$(date -u +%Y-%m-%dT%H:%M:%SZ)")"'"'
    case "$H_PCT" in ''|*[!0-9.]*) ;; *) _body+=',"five_hour":{"used_percentage":'"$H_PCT"',"resets_at":"'"$(_esc "$H_RST")"'"}' ;; esac
    case "$D_PCT" in ''|*[!0-9.]*) ;; *) _body+=',"seven_day":{"used_percentage":'"$D_PCT"',"resets_at":"'"$(_esc "$D_RST")"'"}' ;; esac
    _body+='}'
    if printf '%s' "$_body" >"$_tmp" 2>/dev/null; then
      mv -f "$_tmp" "$_cq" 2>/dev/null || rm -f "$_tmp" 2>/dev/null
    else
      rm -f "$_tmp" 2>/dev/null
    fi
  fi
} >/dev/null 2>&1 || true

# ── session time, month cost ─────────────────────────────────────────────────
SESS='—'
if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
  born=$(btime "$TRANSCRIPT"); [ -n "$born" ] && [ "$born" -gt 0 ] 2>/dev/null && SESS=$(fmt_dur $((now-born)))
fi

# month-to-date API-equivalent cost, from a cache the cost script refreshes in
# the background at most every 10 minutes (it takes ~2 s over all transcripts)
MC="$HOME/.claude/session-dash/month-cost.json"; MLOCK="$HOME/.claude/session-dash/.month-cost.lock"
MONTH_NOW=$(TZ=Asia/Kolkata date +%Y-%m); MONTH_TXT=''
if [ -f "$MC" ]; then
  read -r m_month m_usd < <(awk '
    function find_str(json, key,    pat, s) {
      pat = "\"" key "\"[ \t\r\n]*:[ \t\r\n]*\"([^\"\\\\]|\\\\.)*\""
      if (!match(json, pat)) return ""
      s = substr(json, RSTART, RLENGTH); sub(/^[^:]*:[ \t\r\n]*"/, "", s); sub(/"$/, "", s); return s }
    function find_num(json, key,    pat, s) {
      pat = "\"" key "\"[ \t\r\n]*:[ \t\r\n]*(-?[0-9]+(\\.[0-9]+)?([eE][+-]?[0-9]+)?|null)"
      if (!match(json, pat)) return ""
      s = substr(json, RSTART, RLENGTH); sub(/^[^:]*:[ \t\r\n]*/, "", s); return s == "null" ? "" : s }
    { j = $0; printf "%s %s\n", find_str(j, "month"), find_num(j, "usd") }
  ' "$MC" 2>/dev/null)
  [ "$m_month" = "$MONTH_NOW" ] && MONTH_TXT=$(awk -v u="$m_usd" 'BEGIN{ s=sprintf("%.0f",u); o=""; while(length(s)>3){ o=","substr(s,length(s)-2) o; s=substr(s,1,length(s)-3) } printf "$%s%s", s, o }')
  m_age=$(( now - $(mtime "$MC" || echo 0) ))
else m_age=999999; fi
[ -d "$MLOCK" ] && [ $(( now - $(mtime "$MLOCK" || echo 0) )) -gt 300 ] && rmdir "$MLOCK" 2>/dev/null
if { [ "$m_age" -gt 600 ] || [ -z "$MONTH_TXT" ]; } && [ -x "$HOME/.claude/session-dash/bin/cost.py" ] \
    && python3 -c '' >/dev/null 2>&1 && mkdir "$MLOCK" 2>/dev/null; then
  ( python3 -I "$HOME/.claude/session-dash/bin/cost.py" month-cache; rmdir "$MLOCK" ) >/dev/null 2>&1 &
fi
MONTH_LBL=$(TZ=Asia/Kolkata date +%b)

# ── heat-scale bar ───────────────────────────────────────────────────────────
# pills <pct> <count> <pace 0..1 or ''>: ▰ lit in heat colour, ▱ unlit,
# and the even-pace pill as ◆ (reached) or ◇ (not yet)
pills() { awk -v p="${1:-0}" -v n="$2" -v t="$3" 'function mix(a,b,f){ return int(a+(b-a)*f+0.5) }
  function heat(x,   r,g,b,f){ # x = position 0..1 on the shared scale
    if (x < 0.70) { r=125; g=216; b=160 }
    else if (x < 0.90) { f=(x-0.70)/0.20; r=mix(125,245,f); g=mix(216,196,f); b=mix(160,105,f) }
    else { f=(x-0.90)/0.10; r=mix(245,245,f); g=mix(196,125,f); b=mix(105,120,f) }
    return sprintf("\033[38;2;%d;%d;%dm", r, g, b) }
  BEGIN{ lit=int(p/100*n+0.5); if(lit>n)lit=n; if(lit<0)lit=0
    tk=-1; if(t!="") { tk=int(t*n); if(tk>n-1)tk=n-1 }
    out=""
    for(i=0;i<n;i++){
      if(i==tk) out=out "\033[38;2;240;242;252m" (i<lit ? "◆" : "◇")
      else if(i<lit) out=out heat((i+0.5)/n) "▰"
      else out=out "\033[38;2;96;104;138m▱"
    }
    printf "%s\033[0m", out }'; }
lvl() { local p=${1%.*}; p=${p:-0}
  if [ "$p" -ge 90 ] 2>/dev/null; then printf '%s' "$HOT"
  elif [ "$p" -ge 70 ] 2>/dev/null; then printf '%s' "$WATCH"; else printf '%s' "$OK"; fi; }
even() { local rsec=$1 len=$2; [ -z "$rsec" ] && return
  awk -v r="$rsec" -v n="$now" -v l="$len" 'BEGIN{ f=1-(r-n)/l; if(f<0||f>1) exit; printf "%.4f", f }'; }

# IST: "1:50 AM" today · "tomorrow 1:50 AM" · "Wed 14 Oct, 2:30 PM" beyond
when() { local s=$1 day; day=$(TZ=Asia/Kolkata dfmt "$s" +%F)
  if [ "$day" = "$(TZ=Asia/Kolkata dfmt "$now" +%F)" ]; then TZ=Asia/Kolkata dfmt "$s" '+%-I:%M %p'
  elif [ "$day" = "$(TZ=Asia/Kolkata dfmt $((now+86400)) +%F)" ]; then TZ=Asia/Kolkata dfmt "$s" '+tomorrow %-I:%M %p'
  else TZ=Asia/Kolkata dfmt "$s" '+%a %-d %b, %-I:%M %p'; fi; }

PILLS=10
# one gauge: icon, label, colour, pct, pace, info — fixed columns, info left-aligned
gauge() { local icon=$1 label=$2 col=$3 p=$4 tick=$5 info=$6 pi=${4%.*}
  local head; head=$(pad "${col}${icon} ${label}${R}" 12)
  if [ -z "$p" ]; then printf '%s %s   %s—%s' "$head" "$(pills 0 $PILLS '')" "$DIM" "$R"; return; fi
  printf '%s %s  %s%s%4s%%%s   %s' "$head" "$(pills "$p" $PILLS "$tick")" "$B" "$(lvl "$pi")" "$pi" "$R" "$info"; }
resets() { local s=$1; [ -z "$s" ] && { printf '%sreset time unknown%s' "$DIM" "$R"; return; }
  printf '%sresets%s %s%s%s %s· in %s%s' "$DIM" "$R" "$FG" "$(when "$s")" "$R" "$DIM" "$(fmt_dur $((s-now)))" "$R"; }

# ── header: model chip, effort dots, money, clock ───────────────────────────
case "$EFFORT" in low) EN=1;; medium) EN=2;; high) EN=3;; xhigh) EN=4;; max) EN=5;; *) EN=0;; esac
DOTS=''; for i in 1 2 3 4 5; do if [ "$i" -le "$EN" ]; then DOTS+="${IDENT}●"; else DOTS+="${FAINT}○"; fi; done
W1=$(( ${H_PCT%.*}+0 )); W2=$(( ${D_PCT%.*}+0 )); [ "$W2" -gt "$W1" ] && W1=$W2
CHIP_BG=$(bg $IDENT_RGB); [ "$W1" -ge 80 ] && CHIP_BG=$(bg 245 196 105); [ "$W1" -ge 90 ] && CHIP_BG=$(bg 245 125 120)
HEAD="${CHIP_BG}$(tc 24 22 40)${B} ✦ ${MODEL} ${R}"
[ "$EN" -gt 0 ] && HEAD+="  ${DOTS}${R} ${DIM}${EFFORT}${R}"
COSTF=$(awk -v c="${COST:-0}" 'BEGIN{printf "%.2f", c}')
MONEY_TXT="${MONEY}${B}\$${COSTF}${R} ${DIM}session${R}"
[ -n "$MONTH_TXT" ] && MONEY_TXT+=" ${DIM}·${R} ${MONEY}${MONTH_TXT}${R} ${DIM}${MONTH_LBL}${R}"
HEAD="$(pad "$HEAD" 30)${MONEY_TXT}   ${DIM}◴${R} ${FG}${SESS}${R}"

H_SEC=$(epoch "$H_RST"); D_SEC=$(epoch "$D_RST")
CTX_INFO="${FG}$(fmt_tok "$CTX_NOW")${R} ${DIM}of $(fmt_tok "$CTX_SIZE") tokens${R}"

printf '%s\n' "$HEAD"
printf '%s\n' "$(gauge ◔ Context "$C_CTX" "$CTX_PCT" '' "$CTX_INFO")"
printf '%s\n' "$(gauge ◷ 5-hour "$C_5H" "$H_PCT" "$(even "$H_SEC" 18000)" "$(resets "$H_SEC")")"
printf '%s\n' "$(gauge ▦ 7-day "$C_7D" "$D_PCT" "$(even "$D_SEC" 604800)" "$(resets "$D_SEC")")"
