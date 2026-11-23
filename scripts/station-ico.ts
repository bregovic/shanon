/** Ikona instalátoru Shanon pro Windows (src/station/setup/shanon.ico) z loga — volá scripts/build-station-exe.ps1. */
import { writeFileSync } from "node:fs";
import { shanonIco } from "../src/server/station-installer";

void shanonIco().then((ico) => writeFileSync("src/station/setup/shanon.ico", ico));
