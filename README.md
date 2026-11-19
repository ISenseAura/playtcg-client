Play TCG Client
========================================================================

This repository is a fork of the [Pokémon Showdown client][ps-client] that
adds a Pokémon Trading Card Game (TCG) front-end on top of the existing
battle client. It is paired with `playtcg-server`, a modified Pokémon
Showdown server that runs the TCG engine (WaveTCG); this repository contains
only the client.

Play TCG is an independent fan project. It is not an official Pokémon
product, and it is not an official Pokémon Showdown product.

Upstream Pokémon Showdown documentation and conventions still apply: most
of this README is inherited from upstream and describes how the client is
built and tested. Sections that are specific to this fork are marked.

  [ps-client]: https://github.com/Zarel/Pokemon-Showdown-Client

Upstream navigation: [Website][1] | [Server repository][2] | [Client repository][ps-client] | [Dex repository][3]

  [1]: http://pokemonshowdown.com/
  [2]: https://github.com/smogon/pokemon-showdown
  [3]: https://github.com/Zarel/Pokemon-Showdown-Dex

Credits
------------------------------------------------------------------------

Play TCG uses data and images from these projects:

- [pokemon-tcg-data][c1]: card and set data
- [Limitless TCG][c2]: deck list format and TCG Pocket card images
- [Pokémon TCG API][c3]: card images
- [Scrydex][c4]: card images

Thanks to all of them. Pokemon, the card names and the card artwork belong
to their owners (Nintendo, The Pokemon Company, Creatures and GAME FREAK).

  [c1]: https://github.com/PokemonTCG/pokemon-tcg-data
  [c2]: https://limitlesstcg.com/
  [c3]: https://pokemontcg.io/
  [c4]: https://scrydex.com/

Introduction
------------------------------------------------------------------------

Pokémon Showdown is a browser-based battle simulator. This repository is
the client; a separate server implementation is required to run battles
and TCG games. The upstream client runs `play.pokemonshowdown.com`.

**WARNING: You probably want the [Pokémon Showdown server][4]**, if you're
setting up a server.

  [4]: https://github.com/smogon/pokemon-showdown

Browser support
------------------------------------------------------------------------

Play TCG needs an up-to-date browser. The TCG board uses modern browser
features (CSS `:has()`, `aspect-ratio` and container queries, Pointer Events,
and the Web Animations API), so use a current version of one of these:

 - Chrome, or another Chromium browser (Edge, Brave, Opera, Vivaldi...)
 - Firefox
 - Safari
 - the mobile versions of Chrome, Firefox and Safari

Older browsers, including Internet Explorer and old versions of Safari, are
not supported: the board may not lay out or animate correctly in them. (Tho future goal is to support these, basically whatever PS supports, we should support that.)

Play TCG is mostly developed on Chrome, and there is no exact list of tested
browser versions. If something looks wrong in a current browser, please
report it.

New client
------------------------------------------------------------------------

Play TCG is built on Pokémon Showdown's new client (the client rewrite).
The live Play TCG client runs at https://ptcg.pnine.me/

Client testing requires a build step! Install the latest Node.js (we
require v22 or later) and Git, and run `node build` (on Windows) or `./build`
(on other OSes) to build after each change.

(This will do a fast build with no checks. For tests, linting, and
typechecking, you'll want to do `npm test` separately.)

You can make and test client changes simply by building after each change,
and opening `play.pokemonshowdown.com/testclient-new.html`. This will allow you
to test changes to the client without setting up your own login server.

In this fork, `testclient-new.html` connects to a game server at
`localhost:8000` by default, because TCG games need a server that runs the
TCG engine, such as a local `playtcg-server`. See "Other servers" below to
connect somewhere else.

### Test keys

For security reasons, browsers [don't let other websites control PS][5], so
they can't screw with your account, but it does make it harder to log in on
the test client.

If you need a logged-in account, add a `config/testclient-key.js` file, with
the contents:

    const POKEMON_SHOWDOWN_TESTCLIENT_KEY = 'sid';

Replace `sid` with the contents of your actual PS `sid` cookie. You can quickly
grab it from:

> https://play.pokemonshowdown.com/testclient-key.php

Make sure to put it in `config/` and not `play.pokemonshowdown.com/config/`.

  [5]: https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS

### Other servers

You can connect to an arbitrary server by navigating to
`testclient-new.html?~~host:port`. For example, to connect to a server running
on port 8001, you can navigate to `testclient-new.html?~~localhost:8001`.
Without `?~~host:port`, this fork's test client uses `localhost:8000`.

**NOTE**: Certain browsers will convert `'?'` to `'%3F'` when reading files off
of the local filesystem. As a workaround, try using a different browser or
serving the files locally first (ie. run `npx http-server` from the
directory this README is in, then navigate in your browser to
`http://localhost:8080/testclient-new.html?~~localhost:8000`).

### Limitations

Even with a test key, the following things will fail in `testclient`:

+ Registering
+ Logging into other accounts (you can still switch to other unregistered
  accounts and back, though)

Everything else can be tested.

TCG client (fork-specific)
------------------------------------------------------------------------

The TCG front-end lives alongside the battle client:

- Source: `play.pokemonshowdown.com/src/battle-tcg*.ts(x)`,
  `play.pokemonshowdown.com/src/panel-tcg-deck.tsx`
- Styles: `play.pokemonshowdown.com/style/tcg*.css`
- Assets: `play.pokemonshowdown.com/fx/tcg/`
- Tests: `test/battle-tcg-*.test.js` and `test/tcg-*.test.js`

Two helper scripts under `scripts/` regenerate the card and set indexes
the deck builder reads from a built WaveTCG checkout:

    node scripts/build-tcg-cards-index.js [path-to-wave-tcg]
    node scripts/build-tcg-sets-index.js [path-to-wave-tcg]

Without a path they use `WAVE_TCG_DIR`, then `caches/wave-tcg`. A
`playtcg-server` checkout also works: it keeps WaveTCG in its `Wave-TCG/`
folder.

When a public WaveTCG repository URL is set in `build-tools/wave-tcg.js`,
`node build full` checks WaveTCG out into `caches/wave-tcg`, builds it, and
runs both scripts. Until then, the full build skips that step, and the tests
that need WaveTCG are skipped unless `WAVE_TCG_DIR` points at a built
checkout.

### Hosting

The Play TCG client is hosted at `ptcg.pnine.me`. That domain is set as
`client` in `config/routes.json`; change it if you host the client
somewhere else.

### Replays (fork-specific)

`/replays` (or `/replay`) opens the client's built-in replay browser. It
searches the replays saved on the game server the client is connected to,
for example `playtcg-server`, by username and format. In
`play.pokemonshowdown.com/.htaccess`, `/replays` is rewritten to the client
page instead of redirecting to `replay.pokemonshowdown.com`.

### Login relay (fork-specific)

Play TCG uses Pokémon Showdown accounts. The login page runs on the Play
TCG site, not on `play.pokemonshowdown.com`, so the browser cannot send
the login straight to Pokémon Showdown and keep its login cookie. To
make login work, the client sends every login request to the relay script
`action.php`, which is in this repository at
`play.pokemonshowdown.com/action.php` and is served from the same site as
the client. The relay then forwards the request to the official Pokémon
Showdown login server.

What `action.php` does:

- It forwards the login request, as it is, to the Pokémon Showdown login
  server (`https://play.pokemonshowdown.com/~~<server>/action.php`).
- It also forwards the browser's cookies for the Play TCG site.
- Pokémon Showdown checks the username and password and sends back the
  answer.
- It passes the answer back to the browser and saves Pokémon Showdown's
  session cookie as a cookie for the Play TCG site, so you stay logged in
  after a refresh.

This means the login request, including the password, and the session
cookie go through the Play TCG server. Pokémon Showdown still decides
whether the login is valid. Only run the relay on a server you trust, and
serve the site over HTTPS.

The test client is the exception: when it runs on another host, it sends
logins straight to `play.pokemonshowdown.com`, using your test key.

Requirements:

- PHP with the cURL extension.
- `action.php` must be served from the same site as the client.
- The server must be able to reach `https://play.pokemonshowdown.com`.

If login is not working:

- "PHP cURL is required for the login proxy": install or enable PHP's cURL
  extension.
- "login server unavailable": the server cannot reach
  `play.pokemonshowdown.com`. Check its network, DNS and HTTPS settings.
- "invalid server": the server id sent by the client has unexpected
  characters. Check the server settings in your config.
- An error such as 404 or 405, or the PHP code is shown instead of an
  answer: PHP is not running for `action.php`, or the file is not at
  `/action.php` on the client's site.
- You log in, but a refresh logs you out: the session cookie was not
  saved. Use HTTPS, and check that the browser is not blocking cookies for
  the site.

Warning
------------------------------------------------------------------------

This repository is not "batteries included". It does NOT include instructions
to run a full Pokémon Showdown login server, and we will not provide them.
Please do not ask for help on this; you will be turned away.

If you make a mistake hosting a login server, your users' passwords can get
stolen, so we do not want anyone to host a login server unless they can
figure out how to do it without help.

It also doesn't include several resource files (namely, the `/audio/` and
`/sprites/` directories) for size reasons.

On the other hand, as long as you don't want to run your own login server,
this repository contains everything you need to test changes to the client;
just see the "Testing" section above.

License
------------------------------------------------------------------------

Pokémon Showdown's client is distributed under the terms of the [AGPLv3][6].

The reason is mostly because I don't want low-effort proprietary forks that add bad code that steals everyone's passwords, or something like that.

If you're doing _anything_ else other than forking, _especially_ if you want to some client code files in your own open-source project that you want to release under a more permissive license (like, if you want to make your own multiplayer open-source game client for a different game), please ask at `staff@pokemonshowdown.com`. I hold all the copyright to the AGPLv3 parts and can relicense them to MIT for you.

  [6]: http://www.gnu.org/licenses/agpl-3.0.html

**WARNING:** This is **NOT** the same license as Pokémon Showdown's server.
