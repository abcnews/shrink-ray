import { basename, dirname, join } from 'path';
import tempy from 'tempy';
import { zip } from 'zip-a-folder';
const ffmpeg = require('fluent-ffmpeg');
const { generate } = require('shortid');

ffmpeg.setFfmpegPath(
  require('@ffmpeg-installer/ffmpeg').path.replace(
    'app.asar',
    'app.asar.unpacked'
  )
);

ffmpeg.setFfprobePath(
  require('@ffprobe-installer/ffprobe').path.replace(
    'app.asar',
    'app.asar.unpacked'
  )
);

type OutputOptions = string[];

type VideoFilters = string[];

interface AspectRatioConfig {
  outputOptions: OutputOptions;
  videoFilters: VideoFilters;
}

interface Stream {
  height: number;
  nb_frames: number;
  r_frame_rate: string;
  width: number;
}

interface Metadata {
  streams: Stream[];
}

interface Progress {
  currentFps: number;
  frames: number;
  percent: number;
  timemark: string;
}

type Logger = (message: string) => void;

interface ShrinkRayOptions {
  logger?: Logger | boolean;
  onProgress?: (progress: Progress) => void;
  shouldRetainAudio?: boolean;
}

const FILE_EXTENSION_PATTERN = /\.\w+$/i;
const ILLEGAL_FILENAME_CHARACTERS_PATTERN = /[^a-zA-Z\d_-]/g;

const COMMON_OUTPUT_OPTIONS: OutputOptions = [
  '-y',
  '-movflags faststart',
  '-profile:v high',
  '-level:v 4.1',
  '-bufsize 3M',
  '-vcodec libx264',
  '-crf 23',
  '-preset veryslow',
];

const ASPECT_RATIO_CONFIGS: { [key: string]: AspectRatioConfig } = {
  '16x9': {
    outputOptions: ['-b:v 1900k', '-maxrate 1900k'],
    videoFilters: ['crop=iw:iw/16*9'],
  },
  '1x1': {
    outputOptions: ['-b:v 1M', '-maxrate 1M'],
    videoFilters: ['crop=min(in_h\\,in_w):min(in_h\\,in_w)'],
  },
};

function probe(file: string) {
  return new Promise<Metadata>((resolve, reject) => {
    ffmpeg.ffprobe(file, (err: Error, metadata: Metadata) => {
      if (err) {
        return reject(err);
      }

      resolve(metadata);
    });
  });
}

const noop: Logger = () => {};

export default async function shrinkRay(
  file: string,
  options?: ShrinkRayOptions
) {
  let { logger, onProgress, shouldRetainAudio } = options || {};

  logger =
    logger === false ? noop : !logger || logger === true ? console.log : logger;

  const commonOutputOptions = COMMON_OUTPUT_OPTIONS.concat(
    shouldRetainAudio ? [] : ['-an']
  );

  try {
    await probe(file);
  } catch (e) {
    const msg = e.stderr || JSON.parse(e.stdout).error.string;

    console.error(new Error(msg));
    return process.exit(1);
  }

  const fileBase = basename(file);
  const fileDir = dirname(file);
  const projectId = generate();
  const projectName = fileBase
    .replace(FILE_EXTENSION_PATTERN, `_${projectId}`)
    .replace(ILLEGAL_FILENAME_CHARACTERS_PATTERN, '_');
  const tempDir = tempy.directory();
  const zipFilePath = join(fileDir, `${projectName}.zip`);

  try {
    await new Promise<void | Error>((resolve, reject) => {
      let command = ffmpeg(file)
        .on('progress', (progress: Progress) => {
          if (onProgress) {
            onProgress(progress);
          }
        })
        .on('end', () => resolve())
        .on('error', reject);

      Object.keys(ASPECT_RATIO_CONFIGS).forEach((aspectRatio, index) => {
        const { outputOptions, videoFilters } = ASPECT_RATIO_CONFIGS[
          aspectRatio
        ];

        command = command
          .output(join(tempDir, `${projectName}-${index + 1}.mp4`))
          .outputOptions(commonOutputOptions.concat(outputOptions))
          .videoFilters(videoFilters);
      });

      command.run();
    });
  } catch (e) {
    console.error(e);
    return process.exit(1);
  }

  await zip(tempDir, zipFilePath);

  logger(`Created ${zipFilePath}`);

  return zipFilePath;
}
