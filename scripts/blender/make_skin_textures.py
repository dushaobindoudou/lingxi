#!/usr/bin/env python3
"""Generate Lingxi's warm procedural skin maps with NumPy and Pillow only.

Run from the repository root. PNG row zero represents UV v=1; iris radii
are measured in UV units (the visible disk has radius 0.5). Bump maps are
linear scalar heights, intended for Blender's Non-Color image setting.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image


def gaussian_blur(field: np.ndarray, sigma: float) -> np.ndarray:
    """Small separable Gaussian, with reflected boundaries and no SciPy."""
    radius = max(1, int(np.ceil(3 * sigma)))
    offsets = np.arange(-radius, radius + 1, dtype=np.float32)
    kernel = np.exp(-0.5 * (offsets / sigma) ** 2)
    kernel /= kernel.sum()
    result = field.astype(np.float32)
    for axis in (0, 1):
        pads = [(0, 0), (0, 0)]
        pads[axis] = (radius, radius)
        padded = np.pad(result, pads, mode="reflect")
        filtered = np.zeros_like(result)
        for i, weight in enumerate(kernel):
            selection = [slice(None), slice(None)]
            selection[axis] = slice(i, i + result.shape[axis])
            filtered += weight * padded[tuple(selection)]
        result = filtered
    return result


def resize(field: np.ndarray, shape: tuple[int, int]) -> np.ndarray:
    """Resample float heights without an intermediate 8-bit quantization."""
    return np.asarray(
        Image.fromarray(field.astype(np.float32)).resize(
            (shape[1], shape[0]), Image.Resampling.BICUBIC
        ), dtype=np.float32,
    )


def fbm(shape: tuple[int, int], octaves: int, seed: int,
        cells: tuple[int, int] = (5, 5)) -> np.ndarray:
    """Gaussian-smoothed value noise, returned approximately in [-1, 1].

    Blur the coarse grids before interpolation, keeping broad octaves cheap
    even at 1024px. Anisotropic grids also provide directional fur noise.
    """
    rng = np.random.default_rng(seed)
    result = np.zeros(shape, dtype=np.float32)
    total = 0.0
    for octave in range(octaves):
        grid = tuple(max(3, min(size, n * 2 ** octave))
                     for size, n in zip(shape, cells))
        noise = gaussian_blur(rng.standard_normal(grid).astype(np.float32), 0.7)
        noise -= noise.mean()
        noise /= max(float(noise.std()) * 2.8, 1e-6)
        weight = 0.53 ** octave
        result += weight * resize(noise, shape)
        total += weight
    return np.clip(result / total, -1, 1)


def coordinates(size: int) -> tuple[np.ndarray, np.ndarray]:
    """Pixel centres, with upward-increasing UV v."""
    u = (np.arange(size, dtype=np.float32) + 0.5) / size
    return np.meshgrid(u, 1 - u)


def smoothstep(low: float, high: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - low) / (high - low), 0, 1)
    return t * t * (3 - 2 * t)


def colour(hex_code: str) -> np.ndarray:
    return np.array([int(hex_code[i:i + 2], 16) / 255
                     for i in (0, 2, 4)], dtype=np.float32)


def mix(a: np.ndarray, b: np.ndarray, amount: np.ndarray) -> np.ndarray:
    return a * (1 - amount[..., None]) + b * amount[..., None]


def angular_noise(theta: np.ndarray, count: int,
                  rng: np.random.Generator) -> np.ndarray:
    """Periodic random angular profile: no seam and no reflected sectors."""
    values = rng.uniform(-1, 1, count).astype(np.float32)
    phase = (theta / (2 * np.pi) % 1) * count
    index = np.floor(phase).astype(np.int32)
    blend = phase - index
    blend = blend * blend * (3 - 2 * blend)
    return values[index % count] * (1 - blend) + values[(index + 1) % count] * blend


def radial_fibres(radius: np.ndarray, theta: np.ndarray,
                  rng: np.random.Generator, warp: np.ndarray) -> np.ndarray:
    """Unequal bundles of bent, branching collagen fibres."""
    bent = theta + 0.035 * warp + 0.025 * np.sin(theta * 7 + radius * 19)
    fibres = np.zeros_like(radius)
    for count, weight in ((160, 0.43), (330, 0.34), (710, 0.23)):
        profile = angular_noise(bent + 0.014 * np.sin(radius * 31 + theta * 9),
                                count, rng)
        # Narrow ridges and broader troughs create varied fibre widths.
        profile = 0.65 * profile + 0.35 * np.sign(profile) * profile ** 2
        envelope = 0.65 + 0.35 * np.sin(radius * rng.uniform(35, 65)
                                      + angular_noise(theta, 31, rng) * 4)
        fibres += weight * profile * envelope
    return fibres


def iris_maps() -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(1101)
    u, v = coordinates(1024)
    radius = np.hypot(u - 0.5, v - 0.5)
    theta = np.arctan2(v - 0.5, u - 0.5)
    clouds = fbm(radius.shape, 5, 1102)
    angular = angular_noise(theta, 43, rng)
    warped_r = radius + 0.008 * angular + 0.006 * clouds
    fibres = radial_fibres(radius, theta, rng, clouds)
    base = mix(colour("c08a3a"), colour("9aa63f"),
               smoothstep(0.23, 0.36, warped_r))
    base = mix(base, colour("7fa05a"), smoothstep(0.35, 0.49, warped_r))
    collarette_r = 0.329 + 0.010 * angular_noise(theta, 61, rng) + 0.008 * clouds
    collarette = np.exp(-((radius - collarette_r) / 0.012) ** 2)
    limbus = smoothstep(0.467, 0.505, warped_r)
    grain = rng.normal(0, 0.006, radius.shape).astype(np.float32)
    variation = 0.13 * fibres + 0.023 * clouds + grain
    base += variation[..., None] * np.array([1.0, 0.91, 0.66])
    base -= collarette[..., None] * np.array([0.095, 0.092, 0.048])
    base -= limbus[..., None] * np.array([0.055, 0.065, 0.035])
    pupil_r = 0.20 + 0.0025 * angular_noise(theta, 73, rng)
    pupil_edge = np.exp(-((radius - pupil_r - 0.006) / 0.007) ** 2)
    base -= pupil_edge[..., None] * np.array([0.09, 0.07, 0.045])
    pupil = colour("252522") + (0.005 * clouds + grain * 0.25)[..., None]
    visible_iris = smoothstep(-0.003, 0.007, radius - pupil_r)
    base = mix(pupil, base, visible_iris)
    # Opaque bleed outside the disk prevents pale/transparent filtering seams.
    rgba = np.dstack((base, np.ones_like(radius)))
    height = 0.50 + visible_iris * (0.105 * fibres + 0.016 * clouds
                                  - 0.035 * collarette - 0.018 * pupil_edge)
    height += grain * 0.8
    return rgba, resize(np.clip(height, 0.35, 0.65), (512, 512))


def ear_maps() -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(2201)
    u, v = coordinates(1024)
    clouds = fbm(u.shape, 5, 2202)
    warp = fbm(u.shape, 3, 2203, (7, 9))
    flow = u + 0.012 * warp + 0.016 * np.sin(v * 4 + u * 7)
    streaks = np.zeros_like(u)
    # Independent envelopes interrupt each fine shaft into short wisps.
    for frequency, weight in ((205, 0.45), (367, 0.35), (491, 0.20)):
        phase = rng.uniform(0, 2 * np.pi)
        envelope = smoothstep(-0.5, 0.65, fbm(u.shape, 2, frequency, (65, 90)))
        streaks += weight * np.cos(flow * frequency * 2 * np.pi + phase) * envelope
    feather = np.clip(0.72 * smoothstep(0.12, 1.0, v)
                      + 0.63 * np.abs(2 * u - 1) ** 1.7 + 0.09 * clouds, 0, 1)
    base = mix(colour("c98d84"), colour("f3e3d8"), feather)
    grain = rng.normal(0, 0.004, u.shape).astype(np.float32)
    base += (0.021 * clouds + 0.024 * streaks + grain)[..., None]
    height = 0.50 + 0.075 * streaks + 0.008 * clouds + 0.7 * grain
    return base, resize(height, (512, 512))


def pebbles(shape: tuple[int, int], spacing: float, seed: int) -> np.ndarray:
    """Jittered cellular domes, evaluated against nine neighbouring cells.

    The soft rounded tops avoid baked directional highlights. Coordinates
    are in pixels, so spacing controls the leather/papillae feature size.
    """
    rng = np.random.default_rng(seed)
    y, x = np.indices(shape, dtype=np.float32)
    x = x / spacing + 1
    y = y / spacing + 1
    ix, iy = x.astype(np.int32), y.astype(np.int32)
    grid = (int(iy.max()) + 3, int(ix.max()) + 3)
    jitter_x = rng.uniform(0.15, 0.85, grid)
    jitter_y = rng.uniform(0.15, 0.85, grid)
    widths = rng.uniform(0.23, 0.39, grid)
    amplitude = rng.uniform(0.7, 1.0, grid)
    domes = np.zeros(shape, dtype=np.float32)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            gx, gy = ix + dx, iy + dy
            distance = (x - gx - jitter_x[gy, gx]) ** 2 + (y - gy - jitter_y[gy, gx]) ** 2
            dome = amplitude[gy, gx] * np.exp(-distance / (2 * widths[gy, gx] ** 2))
            np.maximum(domes, dome, out=domes)
    return domes - domes.mean()


def nose_maps() -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(3301)
    u, v = coordinates(512)
    leather = pebbles(u.shape, 3.3, 3302)
    clouds = fbm(u.shape, 5, 3303)
    grain = rng.normal(0, 0.005, u.shape).astype(np.float32)
    ridge = np.exp(-((v - 0.81) / 0.12) ** 2) * np.exp(-((u - 0.5) / 0.43) ** 4)
    base = colour("b4706c") + (0.037 * clouds + 0.068 * leather + grain)[..., None]
    base += ridge[..., None] * np.array([0.047, 0.039, 0.032])
    # Broad soft slits, tilted toward the centre, without hard ink-like edges.
    nostrils = np.zeros_like(u)
    for centre, tilt in ((0.255, -0.35), (0.745, 0.35)):
        x = u - centre
        y = v - 0.39 - tilt * x
        nostrils += np.exp(-0.5 * ((x / 0.074) ** 2 + (y / 0.020) ** 2))
    base = mix(base, colour("694346"), np.clip(nostrils * 0.79, 0, 1))
    return base, 0.50 + 0.19 * leather + grain * 0.65


def pad_maps() -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(4401)
    u, v = coordinates(512)
    velvet = gaussian_blur(rng.standard_normal(u.shape).astype(np.float32), 0.65)
    clouds = fbm(u.shape, 5, 4402)
    centre = np.exp(-((u - 0.48) ** 2 + (v - 0.55) ** 2) / 0.15)
    grain = rng.normal(0, 0.005, u.shape).astype(np.float32)
    base = colour("a9585a") + (0.027 * clouds + 0.021 * velvet + grain)[..., None]
    base += centre[..., None] * np.array([0.043, 0.036, 0.035])
    return base, 0.50 + 0.059 * velvet + 0.8 * grain


def tongue_map() -> np.ndarray:
    rng = np.random.default_rng(5501)
    u, v = coordinates(512)
    papillae = pebbles(u.shape, 6.0, 5502)
    clouds = fbm(u.shape, 4, 5503)
    grain = rng.normal(0, 0.004, u.shape).astype(np.float32)
    base = colour("c0656b") + (0.026 * clouds + 0.085 * papillae + grain)[..., None]
    base -= ((1 - v) ** 2)[..., None] * np.array([0.058, 0.032, 0.027])
    # Gentle pale papilla tips suggest moisture, without fixed specular glints.
    base += np.maximum(papillae - 0.22, 0)[..., None] * np.array([0.06, 0.042, 0.04])
    return base


def mouth_map() -> np.ndarray:
    rng = np.random.default_rng(6601)
    clouds = fbm((256, 256), 4, 6602)
    patches = smoothstep(-0.55, 0.55, clouds)
    grain = rng.normal(0, 0.004, clouds.shape).astype(np.float32)
    return colour("3a1416") - patches[..., None] * np.array([0.047, 0.020, 0.017]) + grain[..., None]


def save(img_array: np.ndarray, path: Path) -> dict[str, str | int]:
    pixels = np.rint(np.clip(img_array, 0, 1) * 255).astype(np.uint8)
    image = Image.fromarray(pixels)
    image.save(path, format="PNG", optimize=True)
    return {"path": str(path), "bytes": path.stat().st_size,
            "width": image.width, "height": image.height}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path,
                        default=Path("assets/characters/lingxi/v5/textures"))
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    written = []
    for names, generator in (
        (("iris_albedo.png", "iris_bump.png"), iris_maps),
        (("ear_fur.png", "ear_bump.png"), ear_maps),
        (("nose_skin.png", "nose_bump.png"), nose_maps),
        (("pad_skin.png", "pad_bump.png"), pad_maps),
    ):
        for name, pixels in zip(names, generator()):
            written.append(save(pixels, args.out / name))
    written.append(save(tongue_map(), args.out / "tongue.png"))
    written.append(save(mouth_map(), args.out / "mouth_dark.png"))
    print(json.dumps({"files": written}, separators=(",", ":")))


if __name__ == "__main__":
    main()
