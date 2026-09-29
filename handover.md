# ToME 2.3.11-ah — RVIP port

Full RVIP (`~/Games/rvip-tools/RVIP.md`) for ToME `v2.3.11-ah` (the user chose
it over 2.3.8-ah). Plain C with Lua and CMake. Live:
https://ruzzoli.de/roguelikes/tome2/ (index card `tome2.png`).

## Source and changes

- Base: **ToME 2.3.11**, https://github.com/tome2/tome2/tree/dac2d95 (tag v2.3.11-ah)
- Our changes: https://github.com/memmaker/tome2/compare/dac2d95...main (memmaker/tome2)

## Build

- **Native X11 build is still needed**: the web build takes the tolua-generated
  Lua bindings (`build/src/w_*.c`) from it. `build/` is configured with
  `cmake .. -Wno-dev -DCMAKE_POLICY_VERSION_MINIMUM=3.5 -DCMAKE_BUILD_TYPE=Release -DCMAKE_C_FLAGS="-fcommon -w" -DCMAKE_DISABLE_FIND_PACKAGE_GTK2=ON -DCMAKE_DISABLE_FIND_PACKAGE_SDL=ON`.
  Rebuild with `make -C build -j8 && cp build/src/tome .`; run with `./play.sh`
  (layout in `lib/pref/user-x11.prf`) or `~/Desktop/Games/Roguelikes/ToME 2.3.11.app`.
- **Web**: `sh web/build.sh` → `web/dist` (the `-Wcast-function-type-strict`
  sweep is clean), `web/deploy.sh` (target `/var/www/ruzzoli.de/roguelikes/tome2/`).
  Local test: `python3 -m http.server 8765 -d web/dist` (kill your own PID after).
- **User files**: `config.h` sets `PRIVATE_USER_PATH "./lib/user"`. Saves go to
  `lib/user/2.3/save` (Theme saves: `.../save/theme`). Web: one IndexedDB mount
  on `/tome2/lib/user`, `-uPLAYER`; Import detects Theme saves.

## Port

- From the old ToME 2.3.5 port (`~/Games/tome`): auto-explore `X` and `<`/`>`
  stair walking (`cmd2.c` `explore_step`, `do_cmd_stairs`), the visible
  monsters+items list (`xtra1.c`), subwindow names, the bigtile redraw fix
  (`z-term.c`), the 16x16.bmp sprite fixes and graf-new.prf additions, help text.
  New: the bigtile right half is restored when a pop-up closes; explore says
  "too dark" without a light.
- **Enter command menu** (`util.c`): `menu_box()` is a content-sized pop-up
  that scrolls, with mouse support (`KEY_MOUSE`, `mouse_click_x/y`); the menu
  is `do_cmd_menu()` plus a command table grouped like the help, hooked into
  `request_command()`. `main-x11.c` queues `KEY_MOUSE` on a plain click.
- **Inventory cursor and item menus**: `cmd3.c` `inven_screen()`,
  `item_actions[]`, `inven_screen_after()` (called in `dungeon.c` after
  `process_command`). The item is preselected via `item_pre_cmd`/`item_pre_slot`,
  consumed by `get_item` in `object1.c`. The cursor works in every item prompt
  (`object1.c` `item_list_*`). Keypad macros in `pref-x11.prf`.
- **Theme module** has its own `lib/mods/theme/{pref,help}`: the same
  `pref.prf`, `pref-x11.prf`, `user-x11.prf` and `command.txt` changes were
  copied there. `modules.c` now creates `lib/user/2.3/<module>`.
- **Sound**: `lib/xtra/sound/Sound.cfg` plus 101 Dubtrain wavs, mapped from
  ToME's older event names; only `walk` is silent. Town music:
  `web/music/new_town.ogg`.
- **Web** (`web/`, `src/main-web.c`, from the TinyAngband template): ego overlay
  layer, mouse clicks, registered as "x11" in `main.c`, `save_player` syncs,
  `TERM_XTRA_SCANSUBDIR` (module menu). WASM signature trap fixed: the level
  generators are declared `(cptr name)`.
- **Prompt line**: `js_next_event(inkey_flag && character_generated)` in
  `src/main-web.c`; the page tracks term 0 row 0 (`row0` in
  `text`/`wipe`/`clear`) and sends it to `RvipWM.prompt` on `fresh(0)`.
- **ASan** found and fixed: `xtra1.c` negative `stat_ind` during birth;
  `loadsave.c` `do_subrace` unterminated `strncpy`.
- Docs: `tome-2.3.11.html` entry in `build-docs.py` and `guides.py`.

## Testing notes (native)

- Use `~/Games/rvip-tools/xsend <win> keys` and `xwd -id` only. No Ctrl
  support: use `^` then the letter, or the Enter menu.
- Window IDs change between runs: `xwininfo -root -tree | grep '"ToME"'`.

## Open

- Presentation rule 6: every term is still a canvas in `web/tome2.js`; text
  windows should be HTML, only the map a canvas.
- Not clicked in a browser: shop, Export/Import file dialogs (logic checked).
