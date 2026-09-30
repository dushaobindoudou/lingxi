# 灵犀 v5 被毛贴图：最终提示词与自检

生成方式：内置 image_gen；每张均以对应模板作构图输入。最终 PNG 为 1254 × 1254；自检时用 Pillow 缩放到模板的 1024 × 1024，再以 50% 透明度叠加。叠加图保存在 `/private/tmp/claude-501/-Users-liepin-workspace-lingxi/815a31e0-cfc9-45f7-826b-53ae6972afb1/scratchpad/coat-check/`。

## coat_head_front.png（第 2 次）

> Paint a 2D FLAT ALBEDO color map on first exact square template; second image only identity/palette reference. Preserve contour and red eye circles, nose triangle, mouth line exact positions. Warm white inverted V blaze: begins narrow between ear bases at forehead center, widens between eyes, expands below nose to cover ENTIRE muzzle, both whisker pads, chin and lower cheeks. Taupe grey-brown tabby on forehead and side cheeks. Clearly but softly show a natural dark-brown M on upper forehead, irregular radiating markings, soft brow patches and one or two lateral cheek dashes. Around each RED EYE MARKER a NARROW LIGHT TAUPE ring; do not draw filled circular spots or actual eyes. Outer ear triangles taupe. Uniform flat colors, subtly feathered irregular pattern edges, no individual hair strokes, fur texture, directional light, gradients, 3D, shadows or highlights. Exact template alignment, no text/watermark.

自检：轮廓、双眼、鼻子、嘴线对位合格；白色倒 V 从两耳根之间窄起，在两眼之间变宽，下方覆盖吻部和下巴；M 纹及眼外侧斑纹可见；无明显光照渐变。局限：白色眼区比参考图略大，边缘羽化较硬。

## coat_head_top.png（第 2 次）

> Produce a flat graphic 2D albedo color map painted on this exact 1024 square top-of-head template. Preserve silhouette, both horizontal red ear-base markers, both small red marks at bottom, at their exact coordinates. Nose is below canvas. Whole crown warm taupe grey-brown. Broad irregular soft dark brown tabby stripe patches run longitudinally from front/bottom toward back/top and radiate gently. Two ear roots slightly darker around marker lines. A small NARROW warm-white blaze tip at bottom-center only. Color fields must be smooth and flat, their borders mildly feathered; absolutely no individual hair strands, no fur texture, no lighting, no cast shadow, no highlight, no 3D shading or gradients, no text. Exact template contour, 3-5% bleed.

自检：轮廓和两条耳根线对位合格；头顶纵向放射纹、下方窄白尖均在指定位置；无明显光照渐变。局限：深色纵纹偏对称，羽化范围偏窄。

## coat_body_top.png（第 2 次）

> Strictly edit the first template into a flat 2D coat ALBEDO map. Exact pixel-aligned square composition and silhouette. Top of canvas = rump and tail root: it MUST REMAIN TAUPE TABBY throughout, NO WHITE at top. Bottom of canvas = front chest/neck: warm white only near bottom center and the four protruding leg areas. Main long torso entirely taupe tabby. A dark brown softly feathered spine line vertically down center, with clearly visible broad irregular wavy mackerel stripes branching perpendicular outward to left and right, varied widths and spacing. Reference image 2 provides kitten palette. Flat uniform color regions, no fur texture, no hairs, no directional lighting, no shadows, no depth, no gradients. Preserve exact silhouette. No text or watermark.

自检：轮廓对位合格；臀部到尾根保持虎斑，脊线和横向鲭鱼纹可见，下方胸前白色；无明显光照渐变。局限：背部条纹仍略规律、近似左右镜像；侧伸轮廓的白区较少，需在模型渲染中核对。

## coat_body_side.png（第 3 次）

> Flat game texture paint-over of this exact square template; do not change canvas or silhouette geometry. Leftmost large round lobe is ENTIRELY WARM WHITE, including its top half: it represents the white chest ruff, NOT tabby head. All legs and paws and lower belly are warm white. Start taupe tabby only to right of narrow neck junction at x≈390 of 1024; taupe on upper half of long torso only, with irregular soft dark brown descending mackerel marks. Rear right leg entire shape white; torso rump above it taupe. White/tabby boundary soft and irregular. Keep blue ground line exact. No lighting gradient, no fur texture, no 3D, no shadows/highlights, no text. Pixel-perfect silhouette of input.

自检：轮廓和蓝色地线对位合格；颈前圆鼓、腹部、前后腿和爪子均白，虎斑限于体侧上半；无明显光照渐变。局限：体侧条纹较规则，白虎斑交界羽化偏窄。

以上仅为贴图与模板叠加自检；尚未贴到 3D 模型渲染四视图，因此最终跨投影接缝与模型观感未验证。

## 根据模型渲染反馈重画（本轮各 1 次）

生成方式：内置 image_gen。输入包括对应模板、旧贴图和身份参考；输出为 1254 × 1254 RGBA。叠加图位于同一 `coat-check/` 目录，文件名为 `coat_head_front-r2-overlay.png` 和 `coat_body_side-r2-overlay.png`。

### coat_head_front.png

> Exact template registration. Keep centered warm-white inverted V, narrow on forehead and wider between the eyes, with white muzzle no wider than the eye outer edges. Both outer cheeks remain warm-taupe tabby from the brow to below the eyes and down to mouth-line height. Strong irregular dark-brown M, brow patches and cheek stripes; dark eye-marker interiors. Flat unlit albedo, no individual fur, red guides or text.

自检：50% 叠加已亲自查看。剪影、眼位、鼻位与嘴位相符；两颊虎斑延伸到嘴线高度，眼圈不再是大块浅色。清除了生成图中的红色鼻、嘴标记。局限：边缘仍有极细的模板色杂边，花纹左右较对称。

### coat_body_side.png

> Exact side template, facing left. Warm-taupe tabby continuously covers the upper neck/shoulder lobe, back, upper side, rump and tail root. Warm white only on front chest below the shoulder, lower belly, lower legs and paws. Place a broad, soft, irregular white/tabby boundary below mid-side. Dark-brown mackerel marks vary in width and break irregularly. Flat unlit albedo; no guide lines, hairs or text.

自检：50% 叠加已亲自查看，并按模板灰色剪影修正最终 alpha；肩颈上部与背部虎斑连通，白色胸前、腹部和腿部的位置符合目标；无蓝地线。局限：条纹仍有规律感，白与虎斑交界偏硬；需要下一次模型渲染确认观感。

## iris_albedo v2

生成方式：内置 imagegen，参考 logo、旧虹膜和模型眼睛特写，共生成 4 次；选用第 4 次的纤维纹理。最终用 Pillow 将色彩饱和度降低约 22%，把瞳孔校正为半径等于虹膜半径 50% 的纯黑圆盘，并将虹膜圆盘外校正为纯黑；瞳孔边缘约 2 像素柔化。输出为 1254 × 1254 RGB PNG。

最终 prompt：

> Final production asset: straight-on, flat, unlit square feline iris albedo. Use prior iris fibers as texture reference, kitten logo for muted olive-hazel palette. The central pupil is a SIMPLE SOLID BLACK GRAPHIC DISK of radius 25% of canvas width, centered precisely. It covers all radial texture underneath. BLACK means RGB 0,0,0, with no brown fibers and no light dots. Surrounding iris: warm gold-brown collarette, fine dense irregular realistic cat radial fibers, subdued olive-green mid iris, dark outer limbal ring. The entire circle touches all four canvas sides, and four outside corners are pure black. Absolutely no illumination, gradients from light, specular dots, gloss, eyelids, or 3D sphere. No text.

Pillow 自检：中心半径 49% 虹膜半径范围 RGB 均值与最大值均为 (0, 0, 0)；瞳孔目标半径为虹膜半径的 50%，边缘有约 2 像素过渡。外缘暗环（半径 94%–98%）RGB 均值 (52, 45, 27)，低于中段（半径 70%–82%）的 (112, 102, 67)。圆盘外所有像素 RGB 为 (0, 0, 0)；虹膜和瞳孔区域均无近白色高光点。

## 2026-09-28：奶萌治愈版头部花纹与动作表情参考

生成方式：内置 image_gen。头部贴图缩放到模板的 1024 × 1024 后，按模板剪影裁切，并补齐生成图边缘极少量缺色像素；没有改变花纹主体。50% 叠加自检图、正脸与身体背面并排图位于 `/private/tmp/claude-501/-Users-liepin-workspace-lingxi/815a31e0-cfc9-45f7-826b-53ae6972afb1/scratchpad/coat-check/`。

### coat_head_front.png（本轮第 2 次，最终）

> Revise the third image as a precise flat coat albedo map. Keep its exact square registration and head silhouette from first image, and its warm taupe and cream palette matching body map in second image. CRITICAL FIX: eliminate both obvious round eye disks entirely: fill every pixel of those eye-position circles with the SAME surrounding warm taupe base coat, extending nearby subtle natural markings seamlessly across them. Remove the nose triangle and mouth bar completely: continuous cream white muzzle in those spots. Remove any red/yellow guide fragments at silhouette edge. Make all dark tabby markings thinner, lighter, broken and more softly feathered, like the body map; especially small delicate M on forehead. Keep narrow white forehead blaze widening between eyes, then white whisker pads/chin; taupe cheek tabby reaches below eyes. Strict flat unlit colors, no strands, no gradients, no lighting, no eyes, no nose, no mouth, no text. Transparent outside exact head shape.

自检：1024 × 1024；50% 叠加后双眼、鼻、口标记位置对齐；眼位没有异色圆斑，额头白色倒 V 与白色吻部连通，两颊虎斑延伸至眼下；和 `coat_body_top.png` 并排观察，暖灰棕底色及深棕条纹处于接近的配色与对比范围。模板红色辅助线检测为 0 像素，剪影与模板差异 0 像素。局限：条纹仍略对称，边缘比身体图稍锐利。

### coat_head_top.png（本轮第 2 次，最终）

> Use case precise-object-edit. FIX THE SECOND top-of-head flat albedo so its colored coat FILLS THE ENTIRE EXACT GREY SILHOUETTE of template Image 1, including both lower rounded lobes all the way down to y=996/1024. The previous second image incorrectly stops at approximately y=920, leaving two large black/empty lower crescents: extend the warm taupe tabby pattern downward over these crescents, with seamless color and markings, and keep only a small narrow cream-white blaze at bottom center. Use Image 3 for warm taupe and soft brown color and low contrast. Exact shape from Image 1, exact square registration, transparent only OUTSIDE silhouette. Red lines and circles from template must not appear. Flat unlit 2D color, feathered irregular broken tabby marks, no hair strokes, no lighting, no shadows, no eyes, no text.

自检：1024 × 1024；50% 叠加后头顶弧线、耳根线与下方两个圆点位置对齐，花纹填满全部头部剪影，下缘白色小尖角保留；配色比旧头图浅且柔和。模板红色辅助线检测为 0 像素，剪影与模板差异 0 像素。局限：中心纵纹仍略规则。

### lingxi-ref-lick-paw.png（本轮第 2 次，最终）

> Revise image 2 as the same two-panel realistic 3D kitten pose reference. Preserve the exact cute long-haired grey-brown tabby kitten identity from logo image 1, white inverted V face, white chest and paws, hazel green round eyes and pink nose, neutral gray studio scene. CRITICAL anatomical fix to LEFT three-quarter panel: the kitten's RIGHT foreleg must visibly originate at its shoulder, bend up at the elbow, and show the underside PINK PAW PADS rotated toward the mouth. Lower the head toward it. The little pink tongue must physically TOUCH the upper pink paw pad, with no gap. Right side-profile panel similarly has raised right front paw pads contacting tongue, no detached or extra paw. The right paw, shoulder and elbow must be readable through fur. Both panels show active paw-pad grooming, not licking fur on top of the paw. Keep sweet baby-kitten 3D realism, soft gray background, no captions, text, watermark.

自检：两格分别为 3/4 正面和正侧面；两格均能看到抬起前爪的粉色爪垫与舌头接触，肩部到前爪连贯；白色倒 V、白胸白爪、灰棕虎斑、榛绿眼和粉鼻与 logo 相符。满意。

### lingxi-ref-expressions.png（本轮第 2 次，最终）

> Refine Image 2 while preserving its exact 2x2 grid, same kitten identity, same scale and all four expressions. Top left satisfied furry closed eyes with fine downward curved lid lines; top right half-lidded slow blink. Bottom left SMALL YAWN: mouth only moderately open, pink tongue stays inside mouth, two very tiny fangs. Bottom right LICKING LIPS: a SINGLE TINY pink tongue TIP protrudes subtly from the mouth corner, only a few millimeters, not a large tongue covering nose or a split tongue. Same fluffy long-haired warm grey-brown tabby kitten with white V face and chest, round hazel green eyes, pink nose and pink mouth, gentle realistic 3D studio render, light neutral gray background, no text or watermark.

自检：2×2 四格均为同一只猫、相同正面近景构图；闭眼、半眯眼、小哈欠、舔嘴唇四种表情可辨；舔嘴唇的舌尖已明显缩小。满意。局限：哈欠仍略大于“很小的哈欠”，但尖牙和舌头清楚。

### lingxi-ref-face-closeup.png（本轮第 1 次，最终）

> Use case stylized-concept. Single straight-on extreme face closeup of EXACT kitten from logo reference and turnaround, framed from forehead and ear bases to chin with full fluffy cheek outline visible. Long-haired baby kitten, warm grey-taupe soft tabby with delicate broken M markings, white inverted V blaze and white muzzle, prominently fluffy lifted long fur on cheeks matching long body fur, NOT short velour. Huge perfectly round glossy eyes, large dark round pupils occupying approximately 65 percent of iris diameter, thin hazel-green iris ring, delicate dark eyeliner around each eye, bright soft catchlights. Tiny PINK nose, delicate small PINK omega-shaped mouth, pink-taupe mouth line and pale pink philtrum, absolutely no black mouth line. Sweet innocent healing milk-kitten expression. Photorealistic high-quality 3D render and soft studio lighting on neutral light gray seamless background. No text, watermark, extra animals.

自检：同一只灰棕虎斑长毛奶猫；脸颊有蓬松长毛，榛绿眼环、深色大瞳孔、眼线和柔和高光清楚；鼻尖、人中和小 ω 嘴均为粉色系。满意。
