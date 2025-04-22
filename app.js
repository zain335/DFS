import "dotenv/config";
import express from "express";
import basicAuth from "express-basic-auth";
import fs from "fs";
import gracefulFs from "graceful-fs";
import morgan from "morgan";
import { IpfsService } from "./services/ipfs.service.js";

const app = express();
gracefulFs.gracefulify(fs);

app.use(morgan("tiny"));
app.use(express.json({ limit: "150Mb" }));

const CLUSTER_HOST = process.env.IPFS_HOST || "localhost";
const CLUSTER_PORT = "9094";
const PROTOCOL = process.env.IPFS_PROTOCOL || "http";

app.get("/", async function (req, res) {
  try {
    res.send("API");
  } catch (err) {
    console.log("err: ", err);
    res.status(406).json({ msg: err.message });
  }
});

app.use(
  basicAuth({
    users: { admin: process.env.SECRET || "Hi this is the default password" },
  })
);

const basePath = "http://127.0.0.1:9094/";

const isIterable = (object) =>
  object != null && typeof object[Symbol.iterator] === "function";

app.post("/add", async function (req, res, next) {
  try {
    const { is_link = false, is_finalize = false, is_json = false } = req.query;

    if (is_link) {
      const { links } = req.body;

      if (!links || links.length === 0) {
        return res
          .status(400)
          .send("No links provided. Please send a valid array of links.");
      }

      const count = links.length;
      console.log({ request: "is_link", count: count });
      const ipfsService = new IpfsService(links);
      const { directoryCid, failedLinks } = await ipfsService.upload();
      const pinStatus = await ipfsService.pinDirectoryOnCluster(directoryCid);
      console.log({
        count: count,
        cid: directoryCid,
        pinStatus: pinStatus,
        failCount: failedLinks?.length,
      });
      return res.json({
        data: {
          IpfsHash: directoryCid,
          pin: pinStatus,
          failedLinks,
        },
      });
    }
    return res.send("1");
  } catch (err) {
    console.log(err);
    res.status(406).json({ msg: err.message });
  }
});

app.post("/check-status", async function (req, res, next) {
  try {
    const { cid } = req.body;

    const url = `${PROTOCOL}://${CLUSTER_HOST}:${CLUSTER_PORT}/pins/${cid}`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Failed to get status for CID ${cid}: ${response.statusText}`
      );
    }

    const status = await response.json();
    res.json({ status });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: error.message });
  }
});
app.listen(8000);
