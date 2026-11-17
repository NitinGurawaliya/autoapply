"""SeleniumBase CDP-mode launcher for the worker's stealthy browser (src/modules/apply/real-browser.ts).

    python scripts/seleniumbase_cdp_launcher.py [--port N] [--profile DIR] [url]

Starts a real Chrome in SeleniumBase's pure CDP Mode (sb_cdp.Chrome: no chromedriver, no WebDriver, the pattern of
SeleniumBase's examples/cdp_mode/playwright), on `url` (default about:blank), and prints

    READY <endpoint url>            e.g. READY http://127.0.0.1:56123

so the Node side can attach Playwright with connectOverCDP(endpoint). It then serves one command per stdin line and
answers each with one line, "OK <COMMAND> [detail]" or "ERR <COMMAND> <reason>":

    GOTO <url>      open the url through SeleniumBase (stealthier than Playwright's goto, per its playwright ReadMe)
    (no CAPTCHA command: a challenge goes to the person at the screen, never auto-clicked; owner's rule, 17 Nov)
    FRONT           bring the window to the front
    PING            answers PONG
    QUIT            quit Chrome and exit (EOF on stdin does the same)

Older SeleniumBase without sb_cdp: falls back to SB(uc=True) + activate_cdp_mode on --port (required then).
"""
import argparse
import sys
import traceback


def say(line):
    print(line, flush=True)


def serve(sb, endpoint):
    say("READY %s" % endpoint)
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        parts = line.split(" ", 1)
        command = parts[0].upper()
        arg = parts[1].strip() if len(parts) > 1 else ""
        try:
            if command == "QUIT":
                say("OK QUIT")
                break
            elif command == "PING":
                say("OK PING PONG")
            elif command == "GOTO":
                if not arg:
                    say("ERR GOTO no url")
                    continue
                sb.goto(arg)
                say("OK GOTO %s" % arg)
            elif command == "FRONT":
                try:
                    sb.bring_active_window_to_front()
                except Exception:  # noqa: BLE001
                    pass
                say("OK FRONT")
            else:
                say("ERR %s unknown command" % command)
        except Exception as error:  # noqa: BLE001
            say("ERR %s %s" % (command, str(error).replace("\n", " ")[:300]))


def run_pure_cdp(args):
    from seleniumbase import sb_cdp

    kwargs = dict(headed=True, lang="en-US")
    if args.port:
        kwargs["port"] = args.port
    if args.profile:
        kwargs["user_data_dir"] = args.profile
    sb = sb_cdp.Chrome(args.url or "about:blank", **kwargs)
    try:
        serve(sb, sb.get_endpoint_url())
    finally:
        try:
            sb.quit()
        except Exception:  # noqa: BLE001
            pass


def run_uc_mode(args):
    """Older SeleniumBase: UC Mode with a fixed DevTools port, then CDP Mode on it."""
    from seleniumbase import SB

    if not args.port:
        say("ERR this SeleniumBase has no sb_cdp; pass --port")
        sys.exit(2)
    kwargs = dict(uc=True, headed=True, test=False, chromium_arg="--remote-debugging-port=%d" % args.port)
    if args.profile:
        kwargs["user_data_dir"] = args.profile
    with SB(**kwargs) as sb:
        sb.activate_cdp_mode(args.url or "about:blank")
        serve(sb, "http://127.0.0.1:%d" % args.port)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("url", nargs="?", default="about:blank")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--profile", default="")
    args = parser.parse_args()
    try:
        try:
            from seleniumbase import sb_cdp  # noqa: F401
            pure = True
        except Exception:  # noqa: BLE001
            pure = False
        if pure:
            run_pure_cdp(args)
        else:
            run_uc_mode(args)
    except Exception as error:  # noqa: BLE001
        say("ERROR %s" % str(error).replace("\n", " ")[:300])
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
    say("CLOSING")


if __name__ == "__main__":
    main()
