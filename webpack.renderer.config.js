const rules = require('./webpack.rules');

// CSS
rules.push({
  test: /\.css$/,
  use: [{ loader: 'style-loader' }, { loader: 'css-loader' }],
});

// Images (png/jpg/jpeg/gif/ico)
rules.push({
  test: /\.(png|jpe?g|gif|ico)$/i,
  type: 'asset/resource',
});

// Audio (mp3/wav/ogg)
rules.push({
  test: /\.(mp3|wav|ogg)$/i,
  type: 'asset/resource',
});

module.exports = {
  // Put your normal webpack config below here
  module: {
    rules,
  },
};
