const webpack = require('webpack');
const path = require('path');

console.warn(`Building in ${process.env.NODE_ENV || 'development'} mode`);

module.exports = {
  entry: './src/index.js',

  output: {
    path: 'public',
    filename: 'bundle.js',
    publicPath: '',
    libraryTarget: 'var',
    library: 'cronManager',
  },

  module: {
    loaders: [
      {
        test: /\.json$/,
        loader: 'json',
      },
      {
        test: /\.js$/,
        exclude: /node_modules/,
        loader: 'babel-loader?presets[]=es2015&presets[]=react',
      },
    ],
  },

  plugins: process.env.NODE_ENV === 'production' ? [
    new webpack.optimize.DedupePlugin(),
    new webpack.optimize.OccurrenceOrderPlugin(),
    new webpack.optimize.UglifyJsPlugin(),
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': '"production"',
    }),
  ] : [],
};