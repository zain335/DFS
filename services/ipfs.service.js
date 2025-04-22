import { nanoid } from "nanoid";
import fetch from "node-fetch";
import pLimit from "p-limit";
import { CONCURRENCY_LIMIT, DELAY, RETRIES } from "../constants.js";

const IPFS_HOST = process.env.IPFS_HOST || "localhost";
const PROTOCOL = process.env.IPFS_PROTOCOL || "http";
const PORT = "5001";
const CLUSTER_PORT = "9094";

export class IpfsService {
  links = [];
  failedLinks = [];
  constructor(links) {
    this.links = links;
  }

  async upload() {
    const dir = `/${nanoid()}`;
    await this.createDirectoryMFS(dir);

    const limit = pLimit(CONCURRENCY_LIMIT);

    await Promise.all(
      this.links.map(async (link, index) =>
        // Limit the number of concurrent fetches
        limit(async () => {
          try {
            const filename = `${index + 1}.png`;
            const buffer = await this.safeFetch(link, RETRIES, DELAY);

            const cid = await this.addFileToIPFS(buffer);
            if (cid) {
              await this.addFileToDirectoryMFS(filename, cid, dir);
            } else {
              console.log(`Failed to add file to IPFS: ${link}`);
            }
          } catch (error) {
            console.error(error?.message || error);
          }
        })
      )
    );

    const directoryCid = await this.finalizeDirectory(dir);
    return { directoryCid, failedLinks: this.failedLinks };
  }

  async createDirectoryMFS(path) {
    const url = `${PROTOCOL}://${IPFS_HOST}:${PORT}/api/v0/files/mkdir?arg=${path}&parents=true`;
    const response = await fetch(url, { method: "POST" });
    if (!response.ok) {
      throw new Error(`Failed to create directory ${path} in MFS`);
    }
  }

  async addFileToIPFS(buffer) {
    const url = `${PROTOCOL}://${IPFS_HOST}:${PORT}/api/v0/add`;
    const formData = new FormData();
    formData.append("file", new Blob([buffer]));

    const response = await fetch(url, { method: "POST", body: formData });
    if (!response.ok) {
      throw new Error("Failed to add file to IPFS");
    }
    const result = await response.json();
    return result.Hash; // CID of the added file
  }

  async addFileToDirectoryMFS(filename, fileCid, dir) {
    const ipfsPath = `${dir}/${filename}`;
    const url = `${PROTOCOL}://${IPFS_HOST}:${PORT}/api/v0/files/cp?arg=/ipfs/${fileCid}&arg=${ipfsPath}`;

    const response = await fetch(url, { method: "POST" });
    if (!response.ok) {
      throw new Error(`Failed to copy file to MFS at ${ipfsPath}`);
    }
  }

  async finalizeDirectory(dir) {
    const url = `${PROTOCOL}://${IPFS_HOST}:${PORT}/api/v0/files/stat?arg=${dir}`;
    const response = await fetch(url, { method: "POST" });
    if (!response.ok) {
      throw new Error(`Failed to finalize directory at ${dir}`);
    }
    const result = await response.json();
    return result.Hash; // CID of the directory
  }

  async pinDirectoryOnCluster(directoryCid) {
    const url = `${PROTOCOL}://${IPFS_HOST}:${CLUSTER_PORT}/pins/${directoryCid}`;
    try {
      const response = await fetch(url, { method: "POST" });
      if (!response.ok) {
        throw new Error(
          `Failed to pin directory ${directoryCid} on IPFS Cluster`
        );
      }
      return true;
    } catch (error) {
      console.error(
        `Failed to pin CID ${directoryCid} on IPFS Cluster:`,
        error
      );
      return false;
    }
  }

  async safeFetch(link, retries = 3, delay = 1000) {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(link);
        if (!response.ok) {
          throw new Error(`Failed to fetch: ${link} ${response?.statusText}`);
        }
        return await response.arrayBuffer();
      } catch (error) {
        if (i === retries - 1) {
          this.failedLinks.push(link);
          throw error;
        }
        // Delay the next retry with exponential backoff
        const backoff = delay * Math.pow(2, i);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }
}
