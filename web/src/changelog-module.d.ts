// The build's changelog (fork patch #70): web/vite.config.ts makes this module from CHANGELOG.md and git at build time.
declare module 'virtual:shepherdr-changelog' {
  const log: import('@shared/changelog.ts').Changelog
  export default log
}
