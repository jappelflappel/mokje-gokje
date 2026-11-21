const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const h = value => String(value ?? '').replace(/[&<>"']/gu, char => entities[char]);

export const activeTeam = state => state.teams.find(team => team.id === state.activeId);
const nameOf = (state, id) => state.teams.find(team => team.id === id)?.name || 'Team';
const tone = (state, id) => Math.max(0, state.teams.findIndex(team => team.id === id)) % 8;
const teamDot = index => `<span class="team-dot tone-${index}" aria-hidden="true"></span>`;
const coin = '<span class="coin" aria-hidden="true"></span>';
const record = '<span class="record-glyph" aria-hidden="true"></span>';
const cardGlyph = '<span class="card-glyph" aria-hidden="true"></span>';
const checked = condition => condition ? ' checked' : '';
const disabled = condition => condition ? ' disabled' : '';
const actions = { lobby: 'Lobby', ready: 'Volgende beurt', cue: 'Nummer klaar', guess: 'Plaatsen',
  steal: 'Steelkans', result: 'Uitslag', finished: 'Eindstand' };

function header(context, controls = '') {
  return `<header class="site-header">
    <div class="wrap header-inner">
      <div class="brand"><span class="brand-mark" aria-hidden="true"></span><span>Mokje Gokje</span></div>
      <div class="header-tools">
        ${context ? `<span class="header-context">${h(context)}</span>` : ''}
        ${controls}
        <button class="button soft help-button" data-tool="help" type="button">Speluitleg</button>
      </div>
    </div>
  </header>`;
}

function badge(label, style = '') {
  return `<span class="badge ${style}"><span aria-hidden="true"></span>${h(label)}</span>`;
}

function button(label, action, style = 'primary', off = false) {
  return `<button type="button" class="button ${style}" data-action="${action}"${disabled(off)}>${h(label)}</button>`;
}

function card(track, modifier = '') {
  return `<article class="track-card ${modifier}">
    <strong class="track-year">${track.year}</strong>
    <div class="track-name"><b>${h(track.title)}</b><span>${h(track.artist)}</span></div>
  </article>`;
}

function winnerText(state) {
  return state.winnerIds.map(id => nameOf(state, id)).join(' & ');
}

function verdict(state, result) {
  if (result.placedCorrectly) return nameOf(state, result.activeId) + ' pakt de kaart.';
  if (result.receiverId) return nameOf(state, result.receiverId) + ' steelt de kaart.';
  return 'De kaart gaat uit het spel.';
}

function scorePanel(state) {
  return `<section class="panel scoreboard" aria-labelledby="teams-heading">
    <div class="panel-title"><h2 id="teams-heading">Teams</h2><span>${state.teams.length} / 8</span></div>
    ${state.teams.length ? `<ul class="score-list">
      ${state.teams.map((team, i) => `<li class="score-row ${state.activeId === team.id && state.phase !== 'finished' ? 'active-team' : ''}">
        ${teamDot(i)}<span class="score-name">${h(team.name)}</span>
        <span class="score-stat" aria-label="${team.cards} kaarten">${cardGlyph}${team.cards}</span>
        <span class="score-stat" aria-label="${team.coins} munten">${coin}${team.coins}</span>
      </li>`).join('')}
    </ul>` : '<p class="empty-score">Deelnemende teams verschijnen hier.</p>'}
    <p class="score-foot">Winnen met ${state.settings.target} kaarten</p>
  </section>`;
}

function joinPanel(state, urls) {
  return `<section class="panel invite" aria-labelledby="join-heading">
    <div class="panel-title"><h2 id="join-heading">Doe mee</h2><span class="phone-icon" aria-hidden="true"></span></div>
    <div class="qr-frame"><canvas id="room-qr" role="img" aria-label="Scan om mee te doen aan spel ${state.code}" data-url="${h(urls.join)}"></canvas></div>
    <div class="invite-text"><p>Scan met één telefoon per team</p><strong class="room-code" aria-label="Spelcode ${state.code}">${state.code}</strong></div>
    <button type="button" class="button soft copy-button" data-tool="copy-join">Kopieer deelname­link</button>
  </section>`;
}

function vinyl(playing, result) {
  return `<div class="turntable" aria-hidden="true">
    <div class="record-colors"><div class="plinth"></div>
      <div class="vinyl-disc${playing ? ' spinning' : ''}">
        <div class="vinyl-label">
          <span>${result ? 'DE UITSLAG' : 'MOKJE GOKJE'}</span>
          <i></i>
          <small>${result ? result.track.year : '33 ⅓ RPM'}</small>
        </div>
      </div>
      <div class="arm-pivot"></div><div class="tone-arm${playing ? ' needle-on' : ''}"></div>
    </div>
  </div>`;
}

function spotifyLink(url, label, style = 'soft', candidate = '') {
  return `<a class="button ${style}" href="${h(url)}"${url.startsWith('spotify:') ? '' : ' target="_blank" rel="noopener noreferrer"'}${candidate
    ? ` data-next-track="${h(candidate)}" aria-describedby="spotify-background"` : ''}>${h(label)}</a>`;
}

function stealClock(ui) {
  return `<span class="steal-clock" data-steal-clock>${ui.stealSeconds} s</span>`;
}

function bonusControl(state) {
  const result = state.round?.result;
  if (!result) return '';
  return result.bonus
    ? '<p>Bonusmunt uitgedeeld.</p>'
    : button('Geef bonusmunt aan ' + nameOf(state, result.activeId), 'bonus', 'soft');
}

function nextControl(state) {
  const next = state.spotifyNext;
  if (next?.url) {
    return `<div class="stage-actions">${spotifyLink(next.url, 'Volgende nummer', 'primary', next.candidate)}</div>
      <p class="spotify-hint" id="spotify-background">Opent de Spotify-app op deze laptop.</p>`;
  }
  return `<div class="stage-actions">${button(state.remaining === 0 ? 'Bekijk eindstand' : 'Volgende nummer', 'next')}</div>`;
}

function stageText(state, urls, ui) {
  const team = activeTeam(state);
  const result = state.round?.result;
  switch (state.phase) {
    case 'lobby':
      return `${badge('Lobby')}<h2>Wacht op teams</h2>
        <p>${state.teams.length >= 2 ? 'Iedereen binnen? Geef het startsein.' : 'Laat minstens twee teams de QR-code scannen.'}</p>
        <div class="stage-actions">${button('Start spel', 'start', 'primary', state.teams.length < 2)}</div>`;
    case 'ready':
      return `${badge('Aan de beurt', 'blue')}<h2>${h(team.name)}</h2>
        <p>${state.spotifyNext?.url ? 'Open het volgende nummer in de Spotify-app.' : 'Trek een nummer voor dit team.'}</p>
        ${nextControl(state)}`;
    case 'cue':
      return `${badge('Nummer klaar', 'blue')}<h2>Zet Spotify aan</h2>
        <p>${h(team.name)} is aan de beurt. ${state.spotifyCurrent ? 'Start het nummer en bevestig zodra de muziek speelt.' : 'Laat de kaart invoeren op het DJ-scherm.'}</p>
        <div class="stage-actions">${state.spotifyCurrent ? `${button('Muziek speelt', 'open')}
          ${spotifyLink(state.spotifyCurrent, 'Open Spotify opnieuw')}
          ${spotifyLink(state.spotifyCurrent.replace('spotify:track:', 'https://open.spotify.com/track/'), 'Open webspeler', 'text-button')}`
          : `<a class="button primary" href="${h(urls.dj)}" target="_blank" rel="noopener noreferrer">Open DJ-scherm</a>`}
        ${button('Sla nummer over', 'skip', 'text-button')}</div>`;
    case 'guess':
      return `${badge('Plaatsen', 'blue')}<h2>${h(team.name)}</h2>
        <p>Kies op de tijdlijn hieronder of op de teamtelefoon waar het nummer hoort.</p>
        <div class="stage-actions">${state.spotifyCurrent ? spotifyLink(state.spotifyCurrent, 'Open Spotify-app') : ''}
        ${state.spotifyCurrent ? spotifyLink(state.spotifyCurrent.replace('spotify:track:', 'https://open.spotify.com/track/'), 'Open webspeler', 'text-button') : ''}
        ${button('Sla nummer over', 'skip', 'soft')}</div>`;
    case 'steal': {
      const waiting = ui.stealSeconds > 0 ? (state.round.stealWindow?.waiting ?? []).length : 0;
      return `${badge('Steelkans', 'amber')}<h2>Wie durft<br>te stelen?</h2>
        <p>${waiting ? `Nog ${waiting} ${waiting === 1 ? 'team kan' : 'teams kunnen'} stelen of passen. ${stealClock(ui)}` : 'De steelkans is gesloten.'}</p>
        ${state.round.stealWindow?.until ? '' : `<div class="stage-actions">${button('Onthul het jaar', 'reveal')}</div>`}`;
    }
    case 'result':
      return `${badge(result.receiverId ? (result.placedCorrectly ? 'Goed geplaatst' : 'Kaart gestolen') : 'Mis', result.receiverId ? 'green' : 'amber')}
        <h2 class="reveal-year">${result.track.year}</h2>
        <p class="revealed-track"><b>${h(result.track.title)}</b><br>${h(result.track.artist)}</p>
        <p>${h(verdict(state, result))}</p>
        ${bonusControl(state)}
        ${nextControl(state)}`;
    case 'finished':
      return `${badge('Eindstand', 'green')}<h2>${h(winnerText(state))}</h2>
        <p>${state.winnerIds.length === 1 ? 'Wint Mokje Gokje!' : 'Delen de eerste plaats!'}</p>
        ${result ? `<p class="revealed-track"><b>${h(result.track.year)} · ${h(result.track.title)}</b><br>${h(result.track.artist)}</p>` : ''}
        ${bonusControl(state)}
        <div class="stage-actions"><button type="button" class="button primary" data-tool="new">Nieuw spel</button></div>`;
  }
}

function setup(state, draft) {
  const deck = draft?.deck ?? state.settings.deck;
  const target = draft?.target ?? state.settings.target;
  const playlist = draft?.playlist ?? state.settings.playlist;
  return `<section class="panel setup" aria-labelledby="setup-heading">
    <div class="panel-title"><h2 id="setup-heading">Spelinstellingen</h2></div>
    <form id="setup-form" class="setup-grid">
      <fieldset><legend>Spotify</legend>
        <div class="segmented">
          <label><input type="radio" name="deck" value="mix"${checked(deck === 'mix')}><span>Mokje Gokje-mix</span></label>
          <label><input type="radio" name="deck" value="playlist"${checked(deck === 'playlist')}><span>Eigen playlist</span></label>
        </div>
        ${deck === 'playlist'
          ? `<label class="field playlist-field" for="playlist">Spotify-playlistlink<input id="playlist" name="playlist" type="url" placeholder="https://open.spotify.com/playlist/…" value="${h(playlist)}" maxlength="200"></label>`
          : '<p class="field-note">69 hits uit 1961–2025. De host opent elk nummer in Spotify.</p>'}
        ${deck === 'playlist' ? '<p class="field-note">De DJ ziet het antwoord en voert de trackgegevens per ronde in.</p>' : ''}
      </fieldset>
      <fieldset><legend>Kaarten om te winnen</legend>
        <div class="segmented numbers">
          ${[5, 7, 10].map(number => `<label><input type="radio" name="target" value="${number}"${checked(target === number)}><span>${number}</span></label>`).join('')}
        </div>
      </fieldset>
    </form>
  </section>`;
}

function gapLabel(cards, index) {
  if (index === 0) return 'Vóór ' + cards[0].year;
  if (index === cards.length) return 'Na ' + cards.at(-1).year;
  if (cards[index - 1].year === cards[index].year) return 'Bij ' + cards[index].year;
  return 'Tussen ' + cards[index - 1].year + ' en ' + cards[index].year;
}

export function takenGaps(state) {
  return new Map([
    [state.round?.placement, state.activeId],
    ...(state.round?.steals ?? []).map(claim => [claim.gap, claim.teamId])
  ]);
}

function timeline(state, cards, options = {}) {
  if (!cards.length) return '<p class="empty-score">Je krijgt je eerste kaart zodra de host begint.</p>';
  const claims = options.showClaims ? takenGaps(state) : new Map();
  if (!options.choose && !options.showClaims) {
    return `<div class="timeline ${options.horizontal ? 'horizontal' : ''}">${cards.map(track => card(track)).join('')}</div>`;
  }
  const items = [];
  for (let index = 0; index <= cards.length; index += 1) {
    const owner = claims.get(index);
    if (owner) {
      items.push(`<div class="claimed-gap">${teamDot(tone(state, owner))}<span>${h(nameOf(state, owner))}</span></div>`);
    } else if (options.choose) {
      const isSelected = options.selected === index;
      items.push(`<button class="gap${isSelected ? ' selected' : ''}" type="button" data-gap="${index}"
        aria-pressed="${isSelected}"><span class="gap-symbol" aria-hidden="true">${isSelected ? '✓' : '+'}</span>${h(gapLabel(cards, index))}</button>`);
    }
    if (index < cards.length) items.push(card(cards[index]));
  }
  return `<div class="timeline ${options.horizontal ? 'horizontal' : ''}">${items.join('')}</div>`;
}

function history(state) {
  if (!state.history.length) return '';
  return `<section class="panel history" aria-labelledby="history-heading">
    <div class="panel-title"><h2 id="history-heading">Gespeelde nummers</h2></div>
    <ul>${state.history.map(entry => `<li><span class="history-year">${entry.track.year}</span><span><b>${h(entry.track.title)}</b><small>${h(entry.track.artist)}</small></span><span class="history-team">${entry.receiverId ? h(nameOf(state, entry.receiverId)) : 'Uit het spel'}</span></li>`).join('')}</ul>
  </section>`;
}

function mugStage(state, mug) {
  const teams = mug.teams ?? state.teams;
  const names = teams.map((team, index) => {
    const radians = index * 2 * Math.PI / teams.length;
    const x = 50 + 38 * Math.sin(radians);
    const y = 50 - 38 * Math.cos(radians);
    const winner = mug.winner?.id === team.id && !mug.rolling;
    return `<li class="mug-team${winner ? ' mug-selected' : ''}" style="--x:${x}%;--y:${y}%">
      ${teamDot(index)}<span title="${h(team.name)}">${h(team.name)}</span>
    </li>`;
  }).join('');
  return `<section class="stage mug-stage" aria-labelledby="mug-heading">
    <div class="stage-copy">
      <h2 id="mug-heading">Mokje Mokje</h2>
      <div class="mug-outcome" role="status">${mug.winner
        ? `<span>De mok wijst naar</span><strong>${h(mug.winner.name)}</strong>`
        : `<p>${mug.rolling ? 'De mok draait…' : (state.teams.length ? 'Laat de mok een team kiezen.' : 'Laat eerst een team meedoen.')}</p>`}</div>
      <div class="stage-actions">
        <button class="button primary" type="button" data-tool="mug-spin"${disabled(!state.teams.length || mug.rolling)}>Draai de mok</button>
        <button class="button soft" type="button" data-tool="mug-close">Terug naar het spel</button>
      </div>
    </div>
    <div class="mug-board">
      <ul class="mug-teams" aria-label="Teams rond de mok">${names}</ul>
      <div class="mug-rotor${mug.rolling ? ' mug-rolling' : ''}"
        style="--from:${mug.from}deg;--stop:${mug.angle}deg;--elapsed:${mug.rolling ? mug.startedAt - performance.now() : 0}ms" aria-hidden="true">
        <div class="mug-cup"><span></span></div>
      </div>
    </div>
  </section>`;
}

export function hostView(state, urls, ui) {
  const active = activeTeam(state);
  const phaseText = state.phase === 'lobby' ? 'Maak de kamer klaar en nodig de teams uit.'
    : state.phase === 'finished' ? 'De eindstand van deze sessie.' : 'Volg de beurt, tijdlijn en stand van alle teams.';
  return `${header('Host', `<button class="button soft mug-toggle" data-tool="mug-toggle" type="button" aria-pressed="${ui.mug.open}">Mokje Mokje</button>
    <button class="button soft" data-tool="manage" type="button">Spelbeheer</button>`)}
    <main id="main" class="wrap host">
      <div class="screen-heading"><div><h1>Hostscherm</h1><p>${phaseText}</p></div>
        ${state.roundNumber ? `<span class="round-indicator">${record} Ronde ${state.roundNumber}</span>` : ''}
      </div>
      <div class="host-grid">
        <div class="host-left">
          ${ui.mug.open ? mugStage(state, ui.mug) : `<section class="stage phase-${state.phase}" aria-label="Huidige beurt">
            <div class="stage-copy">${stageText(state, urls, ui)}</div>
            ${vinyl(['guess', 'steal'].includes(state.phase), state.round?.result)}
          </section>`}
          ${state.phase === 'lobby' ? setup(state, ui.setup) : ''}
          ${active && state.phase !== 'finished' ? `<section class="panel board" aria-labelledby="board-heading">
            <div class="panel-title"><h2 id="board-heading">Tijdlijn van ${h(active.name)}</h2><span>${active.cards} / ${state.settings.target}</span></div>
            ${timeline(state, state.activeTimeline, { horizontal: true, choose: state.phase === 'guess',
              showClaims: state.phase === 'steal', selected: ui.gap })}
            ${state.phase === 'guess' ? `<div class="board-actions">
              ${button('Bevestig plaatsing', 'place', 'primary', ui.gap === null)}
            </div>` : ''}
          </section>` : ''}
          ${history(state)}
        </div>
        <aside class="host-aside" aria-label="Deelname en stand">
          ${joinPanel(state, urls)}
          ${scorePanel(state)}
        </aside>
      </div>
    </main>`;
}

export function guestView(state, ui) {
  const inProgress = state?.phase && state.phase !== 'lobby';
  const hasRoom = Boolean(state?.code);
  const recover = inProgress || ui.recover;
  const title = hasRoom ? (recover ? 'Hervat je team' : 'Doe mee') : 'Meedoen aan een spel';
  return `${header('Team')}
    <main class="wrap entry" id="main">
      <div class="panel entry-box">
        <div class="entry-art" aria-hidden="true"><span class="brand-mark"></span></div>
        ${hasRoom ? `<span class="entry-code">Spelcode <b>${state.code}</b></span>` : ''}
        <h1>${title}</h1>
        <p>${hasRoom ? (recover ? 'Gebruik de teamcode van acht tekens.' : 'Kies een naam voor jullie team.') : 'Vul de spelcode van het hostscherm in.'}</p>
        ${ui.entryError ? `<p class="form-error" role="alert">${h(ui.entryError)}</p>` : ''}
        ${hasRoom ? `<form id="join-form" class="entry-form">
          ${recover
            ? `<label class="field" for="recovery">Teamcode<input id="recovery" name="recovery" placeholder="ABCDEFGH" value="${h(ui.entryValue)}" autocapitalize="characters" spellcheck="false" autocomplete="off" minlength="8" maxlength="10" required></label>`
            : `<label class="field" for="team-name">Teamnaam<input id="team-name" name="name" placeholder="Bijvoorbeeld De B-kant" value="${h(ui.entryValue)}" autocomplete="off" minlength="2" maxlength="26" required></label>`}
          <button class="button primary" type="submit">${recover ? 'Hervat team' : 'Meld team aan'}</button>
        </form>
        ${!inProgress ? `<button class="button text-button" type="button" data-tool="toggle-recover">${recover ? 'Nieuw team aanmelden' : 'Ik heb al een teamcode'}</button>` : ''}`
        : `<form id="room-form" class="entry-form">
          <label class="field" for="room-code-input">Spelcode<input id="room-code-input" name="code" placeholder="ABCDEFG" autocapitalize="characters" spellcheck="false" autocomplete="off" minlength="7" maxlength="9" required></label>
          <button class="button primary" type="submit">Zoek spel</button>
        </form><a class="button text-button" href="./">Zelf een spel hosten</a>`}
      </div>
    </main>`;
}

function teamPrompt(state, ownTurn, ownSteal, canPlace, canSteal) {
  const active = activeTeam(state);
  switch (state.phase) {
    case 'lobby': return ['Jullie staan klaar', 'Wacht tot de host het spel begint.'];
    case 'ready': return [ownTurn ? 'Jullie zijn aan de beurt' : active.name + ' is aan de beurt', 'De host trekt het volgende nummer.'];
    case 'cue': return [ownTurn ? 'Jullie zijn aan de beurt' : active.name + ' is aan de beurt', 'Luister zodra de DJ het nummer start.'];
    case 'guess': return canPlace
      ? ['Waar hoort dit nummer?', 'Tik op een vak in je tijdlijn en bevestig je keuze.']
      : [active.name + ' plaatst', 'Na de keuze van dit team kun je een ander vak claimen.'];
    case 'steal':
      if (ownTurn) return ['Jullie kaart ligt', 'De andere teams mogen nu proberen het nummer te stelen.'];
      if (ownSteal) return ['Steelpoging bevestigd', 'De host onthult zo wie de kaart krijgt.'];
      if (canSteal) return ['Steel de kaart', 'Kies voor één munt een vrij vak op de tijdlijn van ' + active.name + '.'];
      return ['Steelkans', 'Wacht op de onthulling van het jaar.'];
    case 'result': return [verdict(state, state.round.result), state.round.result.bonus && ownTurn
      ? 'Jullie krijgen ook een bonusmunt.' : 'De host trekt zo het volgende nummer.'];
    case 'finished': return [winnerText(state) + (state.winnerIds.length === 1 ? ' wint!' : ' delen de winst!'),
      'Het spel is afgelopen.'];
  }
}

export function teamView(state, ui) {
  const self = state.teams.find(team => team.id === state.self.id);
  const active = activeTeam(state);
  const ownTurn = self.id === state.activeId;
  const ownSteal = state.round?.steals.some(claim => claim.teamId === self.id);
  const passed = state.round?.stealWindow?.passes.includes(self.id);
  const canPlace = state.phase === 'guess' && ownTurn;
  const canSteal = state.phase === 'steal' && ui.stealSeconds > 0 && state.round.stealWindow?.waiting.includes(self.id);
  const [title, subtitle] = teamPrompt(state, ownTurn, ownSteal, canPlace, canSteal);
  const result = state.round?.result;
  const showClaim = state.phase === 'steal' && ownTurn;

  return `${header('', '<button class="button soft" data-tool="recovery" type="button">Teamcode</button>')}
    <main id="main" class="wrap team-screen${canPlace || canSteal ? ' has-tray' : ''}">
      <div class="team-heading"><div>${teamDot(tone(state, self.id))}<h1>${h(self.name)}</h1></div>
        <div class="team-coins" aria-label="${self.coins} munten">${coin}<strong>${self.coins}</strong></div>
      </div>
      <section class="panel team-turn" aria-label="Huidige beurt">
        ${badge(actions[state.phase], state.phase === 'steal' ? 'amber' : (state.phase === 'finished' ? 'green' : 'blue'))}
        <h2>${h(title)}</h2><p>${h(subtitle)}</p>
        ${result ? card(result.track, 'result-card') : ''}
        ${canSteal ? `<div class="steal-options">${stealClock(ui)}${button('Pas', 'pass', 'soft')}</div>` : ''}
        ${state.phase === 'steal' && !ownTurn && !ownSteal && !canSteal
          ? `<p class="field-note">${passed ? 'Jullie hebben gepast.' : (!self.coins ? 'Jullie hebben geen munten meer.' : 'De steelkans is gesloten.')}</p>` : ''}
      </section>
      ${canSteal ? `<section class="panel team-line" aria-labelledby="steal-heading">
        <div class="panel-title"><h2 id="steal-heading">Tijdlijn van ${h(active.name)}</h2></div>
        ${timeline(state, state.activeTimeline, { choose: true, showClaims: true, selected: ui.gap })}
      </section>` : ''}
      <section class="panel team-line" aria-labelledby="my-cards">
        <div class="panel-title"><h2 id="my-cards">Jullie kaarten</h2><span>${self.cards} / ${state.settings.target}</span></div>
        ${timeline(state, state.self.timeline, { choose: canPlace, showClaims: showClaim, selected: ui.gap })}
      </section>
      ${scorePanel(state)}
    </main>
    ${canPlace || canSteal ? `<div class="action-tray"><div class="tray-inner">
      <div class="tray-label">${ui.gap === null ? 'Kies een vak' : h(gapLabel(canPlace ? state.self.timeline : state.activeTimeline, ui.gap))}</div>
      ${button(canPlace ? 'Bevestig plaatsing' : 'Steel voor 1 munt', canPlace ? 'place' : 'steal', 'primary', ui.gap === null)}
    </div></div>` : ''}`;
}

export function spotifySearch(track) {
  return 'https://open.spotify.com/search/' + encodeURIComponent(track.title + ' ' + track.artist);
}

export function djView(state, ui) {
  const track = state.round?.track;
  const playlist = state.settings.deck === 'playlist';
  const cue = state.phase === 'cue';
  const active = activeTeam(state);
  const dj = ui.dj;
  return `${header('DJ')}
    <main id="main" class="wrap dj-screen">
      <div class="screen-heading"><div><h1>DJ-scherm</h1><p>Speel de muziek af in Spotify.</p></div></div>
      <section class="panel dj-panel">
        ${badge(actions[state.phase], 'blue')}
        <h2>${active ? h(active.name) : 'Wacht op de host'}</h2>
        ${playlist && state.settings.playlist ? `<p><a class="button soft" href="${h(state.settings.playlist)}">Open Spotify-app</a></p>` : ''}
        ${track ? `<div class="dj-track">${card(track)}
          <a class="button primary" href="${h(track.link || spotifySearch(track))}" target="_blank" rel="noopener noreferrer">${track.link ? 'Open in Spotify' : 'Zoek in Spotify'}</a>
        </div>` : ''}
        ${cue && playlist ? `<p>Speel een nummer uit de playlist en vul de kaart in. Gebruik het jaar waarin deze versie voor het eerst uitkwam.</p>
          <form id="dj-form" class="dj-form">
            <label class="field" for="dj-title">Titel<input id="dj-title" name="title" value="${h(dj.title)}" maxlength="110" required></label>
            <label class="field" for="dj-artist">Artiest<input id="dj-artist" name="artist" value="${h(dj.artist)}" maxlength="90" required></label>
            <label class="field" for="dj-year">Uitgavejaar<input id="dj-year" name="year" value="${h(dj.year)}" type="number" inputmode="numeric" min="1900" max="${new Date().getFullYear()}" required></label>
            <label class="field" for="dj-link">Spotify-tracklink <small>optioneel</small><input id="dj-link" name="link" type="url" value="${h(dj.link)}" maxlength="200"></label>
            <button class="button primary" type="submit">Teams laten plaatsen</button>
          </form>` : ''}
        ${cue && !playlist && track ? `<p>Start het nummer in Spotify en open daarna de plaatsing.</p>${button('Teams laten plaatsen', 'open', 'soft')}` : ''}
        ${!track && !cue ? '<p>Het volgende nummer verschijnt zodra de host het trekt.</p>' : ''}
        ${['guess', 'steal'].includes(state.phase) ? '<p>Het scherm van de teams is open.</p>' : ''}
      </section>
    </main>`;
}

export function errorView(title, message, mode) {
  return `${header('')}
    <main class="wrap entry" id="main"><div class="panel entry-box">
      <span class="brand-mark" aria-hidden="true"></span>
      <h1>${h(title)}</h1><p>${h(message)}</p>
      <div class="entry-form"><button type="button" data-tool="${mode === 'stale-host' ? 'create' : 'retry'}" class="button primary">${mode === 'stale-host' ? 'Maak een nieuw spel' : 'Probeer opnieuw'}</button>
      <a class="button text-button" href="./?join">Vul een spelcode in</a></div>
    </div></main>`;
}
