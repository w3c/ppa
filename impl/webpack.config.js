const HtmlWebpackPlugin = require("html-webpack-plugin");
const path = require("path");

module.exports = {
  entry: {
    simulator: "./src/simulator.ts",
  },
  module: {
    rules: [
      {
        test: /\.ts?$/,
        use: [
          {
            loader: "ts-loader",
            options: { onlyCompileBundledFiles: true },
          },
        ],
      },
    ],
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: "./index.html",
    }),
  ],
  output: {
    filename: "[name].js",
    path: path.resolve(__dirname, "dist"),
    clean: true,
  },
};
