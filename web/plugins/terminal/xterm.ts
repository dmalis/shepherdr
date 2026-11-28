// xterm and its stylesheet, fetched together when a terminal first opens (fork #163): neither is in the first
// screen's script or stylesheet.
import '@xterm/xterm/css/xterm.css'
export { Terminal } from '@xterm/xterm'
