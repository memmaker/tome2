# Handover: ToME 2.3.11-ah RVIP (2026-09-25)

Task: do the full RVIP (`~/Games/RVIP.md`) for ToME `v2.3.11-ah`, including the web publishing
(`~/Games/rogue2wasm.md`). The user chose 2.3.11-ah instead of the 2.3.8-ah they first named, and said
"publish once the game is in the required shape": no need to ask again before deploying.

Source: shallow clone of tag `v2.3.11-ah` (https://github.com/tome2/tome2) in `~/Games/tome-2.3.11`.
It is plain C with Lua and CMake. `git diff` shows every local change.

## Done

**Build (native X11).** `build/` is configured with:
`cmake .. -Wno-dev -DCMAKE_POLICY_VERSION_MINIMUM=3.5 -DCMAKE_BUILD_TYPE=Release -DCMAKE_C_FLAGS="-fcommon -w" -DCMAKE_DISABLE_FIND_PACKAGE_GTK2=ON -DCMAKE_DISABLE_FIND_PACKAGE_SDL=ON`.
Rebuild with `make -C build -j8 && cp build/src/tome .`.

**User files.** `config.h` sets `PRIVATE_USER_PATH "./lib/user"`. Saves go to `lib/user/2.3/save`
(Theme saves: `.../save/theme`).

**ASan run.** Done, and it found two real bugs, both fixed:
- `xtra1.c`: negative `stat_ind` during birth.
- `loadsave.c` `do_subrace`: an unterminated `strncpy` on save.

The ASan build and binary have been removed.

**Ported from the old ToME 2.3.5 port (`~/Games/tome`, its `git diff`):**
- auto-explore `X` and `<`/`>` stair walking (`cmd2.c` `explore_step`, `do_cmd_stairs`)
- the visible monsters+items list (`xtra1.c`)
- subwindow names
- the bigtile redraw fix (`z-term.c`)
- the 16x16.bmp sprite fixes and the graf-new.prf additions
- the help text

New in this port:
- The bigtile right half is now also restored when a pop-up closes (`z-term.c`).
- Explore says "too dark" when you carry no light.

**3b, Enter command menu.** `util.c`: `menu_box()` is a generic pop-up sized to its content that
scrolls when needed, with mouse support through `KEY_MOUSE` and `mouse_click_x/y`. The menu itself is
`do_cmd_menu()` plus a command table grouped like the help. It is hooked into `request_command()`.
`main-x11.c` queues `KEY_MOUSE` on a plain click. Tested in X11 and in the web build.

**3c, inventory cursor and item menus.** `cmd3.c` `inven_screen()`, `item_actions[]`,
`inven_screen_after()` (called in `dungeon.c` after `process_command`). The item is preselected
through `item_pre_cmd`/`item_pre_slot`, which `get_item` in `object1.c` consumes. The cursor also
works in every item prompt (`object1.c` `item_list_*`). Keypad macros are in `pref-x11.prf`.
Tested: wear via the menu, keypad 5 in a prompt, equipment screen.

**Theme module.** It has its own `lib/mods/theme/{pref,help}`. The same `pref.prf`, `pref-x11.prf`,
`user-x11.prf` and `command.txt` changes were copied there. Its tiles have **not** been checked yet.

**Launcher and docs.**
- `play.sh` and `lib/pref/user-x11.prf` are in place.
- Desktop shortcut: `~/Desktop/Games/Roguelikes/ToME 2.3.11.app` (icon copied from `ToME.app`).
- Docs: `tome-2.3.11.html` entry in `build-docs.py` and `guides.py` (guide + Saving), built. Backups
  are in the scratchpad.

**6b, sound.** `lib/xtra/sound/Sound.cfg` plus 101 Dubtrain wavs, mapped from ToME's older event
names; only `walk` is silent. Town music: `web/music/new_town.ogg`.

**Web port** (`web/`, `src/main-web.c`, built from the TinyAngband template):
- It adds the ego overlay layer, mouse clicks, one IndexedDB mount on `/tome2/lib/user`, and
  `-uPLAYER`.
- Import detects Theme saves.
- It is registered as "x11" in `main.c`; `save_player` syncs.
- Fixed a WASM signature trap: the level generators are now declared `(cptr name)`.
- `sh web/build.sh` builds `web/dist`; the `-Wcast-function-type-strict` sweep is clean.
- Local test server: `python3 -m http.server 8765 -d web/dist` (PID 79934, **mine, kill when done**).
- Tested in the browser pane:
  - birth
  - town with tiles and all 4 subwindows
  - Enter menu with mouse clicks
  - skills screen
  - item menu
  - wizard jump to level 6 (via `^` then `w` / `a`)
  - explore walking and the locked-door stop

## Not yet built into dist

The last source edits have not been rebuilt into `web/dist` yet:
- `object1.c`: inventory subwindow names are cut to the window width.
- `cmd2.c`: the "too dark" message.

Rebuild both with `make -C build && cp build/src/tome . && sh web/build.sh`.

## Remaining (rogue2wasm checklist, then publish)

1. Rebuild, then finish the browser checklist:
   - `>` stair walk
   - shop
   - `=` options: every entry, plus subwindow flags all on (no crash); `auto_more`/`center_player`
     on for a new character (the map did not look centred, so check this)
   - resize/zoom/rename/reset
   - Help panel (6 sections)
   - Sound/Music buttons
   - Ctrl-S → IndexedDB → reload loads the character
   - `Module._web_request_save()`
   - Ctrl-X → Play again
   - Export/Import
   - the Theme module (start, tiles, save path)
   - no console errors
2. Open question: the module-select screen seemed skipped on the first web load (an early click/space
   probably picked module a). Check that a fresh load shows it.
3. Deploy:
   - `web/deploy.sh` (target `/var/www/ruzzoli.de/roguelikes/tome2/`)
   - check nginx: the `/roguelikes/` no-cache block should already cover it
   - check every file with `curl -sI`, then test the live URL
4. Add a card to `~/Games/roguelikes-index/index.html`: 12×5 monster sprites from `16x16.png`,
   nearest-neighbour. Then `rsync -rtz ~/Games/roguelikes-index/ ruzzoli.de:/var/www/ruzzoli.de/roguelikes/`
   (no `--delete`).
5. Optionally link the web version from the Docs page.
6. Update `RVIP.md`:
   - table row for ToME 2.3.11
   - 3b "Current state"
   - notes: Theme needs its own prefs; the K&R generator WASM trap; the PRIVATE_USER_PATH trick
7. Clean up:
   - kill the http server and any `./tome` from `~/Games/tome-2.3.11` (own PIDs only)
   - delete the test saves `lib/user/2.3/{save/RvipTest,RvipTest.nte,scores.raw,save/global.svg}`
   - leave `build/` in place

## Testing notes

- Use `~/Games/rvip-tools/xsend <win> keys` and `xwd -id` only. There is no Ctrl support: use `^`
  then the letter, or the Enter menu.
- Window IDs change between runs: `xwininfo -root -tree | grep '"ToME"'`.
- Scratchpad helpers are `shot.sh a <keys>` and `restart.sh`.
- Never take full-screen screenshots or send global keys: the user may be playing.

## Finished (2026-09-25, follow-up session)

- Rebuilt and deployed: https://ruzzoli.de/roguelikes/tome2/ (all files 200 + no-cache); index card `tome2.png` live.
- Fixed: web module menu skipped (`main-web.c` lacked `TERM_XTRA_SCANSUBDIR`) and Theme "Fatal Error"
  (`modules.c` never created `lib/user/2.3/<module>`; hit native too).
- Browser checklist passed: Theme birth/tiles/save path/reload/Hall of Fame, options pages, window flags all on,
  auto_more + center_player on (centring clamps at map edges), `<` walk, zoom/reset/rename/drag, Help, Sound/Music,
  `_web_request_save`, Ctrl-X → Play again. Not clicked: shop, Export/Import file dialogs (logic checked).
- Docs link skipped (no other game links its web build). RVIP.md updated. Server killed, test saves deleted.

## Source and changes

- Base: **ToME 2.3.11**
- Original source: https://github.com/tome2/tome2/tree/dac2d95 (tome2/tome2, commit dac2d95 (tag v2.3.11-ah))
- Our changes: https://github.com/memmaker/tome2/compare/dac2d95...main (memmaker/tome2)
