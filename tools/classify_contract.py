#!/usr/bin/env python3
"""Sets class/phase/stub on contract.json from the design's phase list: classify_contract.py <contract.json>
(rerun after extract_contract.py; hand edits made later win if you stop running this)."""
import json, sys

CMD_PHASE = {1: 'settings_get settings_set settings_secret settings_reset settings_open displays_list app_info app_quit log '
                'open_external notch_hitrect notch_opened notch_focus notch_drag svc',
             2: 'helper_state helper_cmd', 4: 'calendar_get calendar_refresh open_calendar_app',
             6: 'shelf_start_drag share_files cat_free notch_arrows'}
SVC_PHASE = {1: 'store notch', 2: 'lyrics audio weather prayer location', 3: 'notif',
             4: 'adhan health pomodoro timer screentime todosync stats wifi location temp clock system github',
             5: 'chat claude brief aiusage translate ai agent paseo'}
EXCLUDED = {'update_state', 'update_check', 'update_page', 'update.whatsNew',
            *('dock.' + m for m in 'taskManager taskView endTask endable fromTaskbar desktops desktopNew desktopClose desktopStep showDesktop start'.split()),
            # Windows' Do not disturb: a Mac's notifications page never asks (notifs.js dndBlock, notch.js)
            'notif.dnd', 'notif.setDnd', 'notif:dndSummary', 'notif:quiet',
            # Windows-only, left out by the Mac frontend itself (settings.js MAC_OFF, notch.js), or retired (phase 6c ruling):
            # FPS counter, Snap Zones, cursors, the moving wallpaper and its colour, the screen colour picker, the
            # real visualizer, per-app auto-hide / gap, arrow keys grabbed globally (a Mac's notch takes them by
            # focus), hiding for fullscreen apps, volume keys taken over, and web search (went with the API keys)
            'fps.allow', 'fps.state', 'snap.apply', 'snap:cursor', 'snap:state',
            *('cursor.' + m for m in 'info pack pick ready set'.split()), 'cursor:render',
            'wallpaper.clear', 'wallpaper.pick', 'wallpaper.state', 'wallcolor.get', 'look:wall', 'colorpick:picked', 'viz',
            'notch:autohideApp', 'notch:topGap', 'notch:arrow', 'notch:navigate', 'notch:leaving', 'notch:hudOnly',
            'hud:edge', 'chat:searching',
            # Windows' radio switches (a Mac's tab is the Wi-Fi / Bluetooth lists and the speed test) and VLC's web
            # status (its row is MAC_OFF): phase 6d ruling
            'radios.set', 'vlc.status',
            # the Dock: a Windows taskbar replacement, off by default, its only switch on the page a Mac hides
            # (MAC_OFF.pages); notch:openTab is sent by it alone (phase 6e ruling)
            *('dock.' + m for m in ('bar click close closeWindow desktop displays dragRaise dropInfo focusWindow glass icon langSettings '
                                    'launch layout layouts memory move openFiles pin pinFiles prayer resetIcon reveal scale setIcon shape '
                                    'state trash unpin windows').split()),
            'dock:leaving', 'dock:maximized', 'dock:moved', 'dock:standby', 'dock:state', 'notch:openTab',
            # Retired 3D buddy entries (replaced by Pony Assistant)
            'cat_free', 'cat.clear', 'cat.data', 'cat.pick', 'cat:place', 'cat:sympony', 'cat:relay', 'notch:cursor',
            # not events: settings.js's own button helper `on('tsIn', …)` read as api.on by the extractor
            'tsCancel', 'tsIn', 'tsNow', 'tsOut'}
TODOSYNC = ['todosync.' + m for m in 'signIn cancel signOut syncNow setList newList'.split()]
FIX = {'notch_arrows', 'location.detect', 'notif.test', 'notif.grantBanners', 'bluetooth.connect', 'bluetooth.disconnect', *TODOSYNC,
       'ai.agents', 'agent.result', 'agent:tool', 'claude.install', 'claude.remove', 'paseo.status', 'paseo.open'}  # (the installed AI agents: the owner's phase 5, 2026-11-19)
# (the extractor misses these: called as `on ? 'connect' : 'disconnect'`, and settings.js's run(method))
EXTRA_METHODS = ['speedtest.start', 'speedtest.cancel', 'bluetooth.connect', 'bluetooth.disconnect', *TODOSYNC, 'claude.install', 'claude.remove']
# events the extractor can't see (subscribed in a loop: modules/data.js `for (const ch of [...]) api.on(ch, …)`)
EXTRA_EVENTS = ['weather', 'health', 'github']
EVENT_PHASE = {1: 'settings settings:section notch:hover notch:toggle notch:camera notch:anchor notch:blur',
               2: 'helper weather stats', 5: 'claude chat:brief aiusage aiusage:alert', 3: 'notif notif:history notif:dndSummary notif:quiet',
               4: 'calendar health:remind clock:changed pomodoro pomodoro:done timer timer:done health health:goal '
                  'prayer:adhanStop todosync github'}
# single methods in another phase than their service: lyrics' romanize/translate need AI
METHOD_PHASE = {'lyrics.romanize': 5, 'lyrics.translate': 5}
LIST_METHODS = {'list', 'agents', 'lists', 'layouts', 'windows', 'displays', 'devices', 'countries', 'zones', 'catalog', 'search', 'suggest'}
STUBS = {'helper_state': {}, 'displays_list': [], 'app_info': {'version': '0.1.0'}, 'settings_get': {},
         'shelf.list': [], 'notif.history': {'unseen': 0}, 'actions.catalog': [], 'pomodoro.get': {}, 'timer.get': {},
         'notch_hitrect': None}


def phase_of(kind, name):
    if kind == 'command':
        return next((p for p, ns in CMD_PHASE.items() if name in ns.split()), 6)
    if kind == 'method':
        if name in METHOD_PHASE:
            return METHOD_PHASE[name]
        return next((p for p, ns in SVC_PHASE.items() if name.split('.')[0] in ns.split()), 6)
    if name.startswith('store:'):
        return 1
    return next((p for p, ns in EVENT_PHASE.items() if name in ns.split()), 6)


def main(path):
    items = json.load(open(path, encoding='utf-8'))
    have = {(i['kind'], i['name']) for i in items}
    items += [{'kind': 'event', 'name': n} for n in EXTRA_EVENTS if ('event', n) not in have]
    items += [{'kind': 'method', 'name': n} for n in EXTRA_METHODS if ('method', n) not in have]
    for i in items:
        n = i['name']
        i['phase'] = (3 if n.startswith('notif.') else 4 if n.startswith(('bluetooth.', 'todosync.')) else 5 if n.startswith(('ai.', 'agent', 'claude.', 'paseo.')) else 2 if i['kind'] == 'method' else 6) if n in FIX else phase_of(i['kind'], n)
        i['class'] = 'excluded' if n in EXCLUDED else 'fix' if n in FIX else 'mac'
        i['stub'] = STUBS.get(n, [] if i['kind'] == 'method' and n.split('.')[1] in LIST_METHODS else None)
    json.dump(items, open(path, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    open(path, 'a', encoding='utf-8').write('\n')


if __name__ == '__main__':
    main(sys.argv[1])
