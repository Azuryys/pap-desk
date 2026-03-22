module.exports = {
  /**
   * This is the main entry point for your application, it's the first file
   * that runs in the main process.
   */
  entry: './src/main.js',
  // Put your normal webpack config below here
  module: {
    rules: require('./webpack.rules'),
  },
  externals: {
    'better-sqlite3': 'commonjs2 better-sqlite3',
    'ffmpeg-static': 'commonjs2 ffmpeg-static',
    'youtube-dl-exec': 'commonjs2 youtube-dl-exec',
  },
};
