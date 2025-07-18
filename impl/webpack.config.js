const path = require("path");

module.exports = {
  entry: {
    example: "./src/example.ts",
    worker: "./src/worker.ts",
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
  output: {
    filename: "[name].js",
    path: path.resolve(__dirname, "dist"),
  },
};
