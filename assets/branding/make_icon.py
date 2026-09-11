from PIL import Image
from pathlib import Path
import sys


# =========================
# 配置
# =========================

PNG_SIZE = 1024

# ICO 内嵌的分辨率
ICO_SIZES = [
    16,
    24,
    32,
    48,
    64,
    128,
    256,
]


# =========================
# 图片处理
# =========================

def create_png(input_file, output_file):
    """生成 1024×1024 PNG"""

    img = Image.open(input_file).convert("RGBA")

    # 保持比例缩放，最长边缩放到 1024
    img.thumbnail(
        (PNG_SIZE, PNG_SIZE),
        Image.Resampling.LANCZOS
    )

    # 创建透明的 1024×1024 画布
    canvas = Image.new(
        "RGBA",
        (PNG_SIZE, PNG_SIZE),
        (0, 0, 0, 0)
    )

    # 居中
    x = (PNG_SIZE - img.width) // 2
    y = (PNG_SIZE - img.height) // 2

    canvas.alpha_composite(img, (x, y))

    canvas.save(
        output_file,
        "PNG"
    )

    return canvas


def create_ico(img, output_file):
    """生成包含多个分辨率的 ICO"""

    # Pillow 会从完整分辨率图像生成 ICO 中的各个尺寸。
    img.save(
        output_file,
        format="ICO",
        sizes=[(s, s) for s in ICO_SIZES]
    )

    print("ICO 内嵌分辨率：")

    for size in ICO_SIZES:
        print(f"  {size} × {size}")


# =========================
# 主程序
# =========================

def main():

    if len(sys.argv) < 2:
        print("使用方法：")
        print("python make_icon.py logo.png")
        return

    input_file = Path(sys.argv[1])

    if not input_file.exists():
        print(f"错误：找不到文件 {input_file}")
        return

    output_dir = input_file.parent

    png_file = output_dir / "app-icon.png"
    ico_file = output_dir / "app-icon.ico"

    print("=" * 50)
    print("Ai Lover 图标生成工具")
    print("=" * 50)

    print(f"\n输入文件：{input_file}")

    # 生成 PNG
    print("\n正在生成 1024×1024 PNG...")
    img = create_png(
        input_file,
        png_file
    )

    print(f"已生成：{png_file}")

    # 生成 ICO
    print("\n正在生成多分辨率 ICO...")
    create_ico(
        img,
        ico_file
    )

    print(f"\n已生成：{ico_file}")

    print("\n全部完成！")
    print("=" * 50)


if __name__ == "__main__":
    main()
