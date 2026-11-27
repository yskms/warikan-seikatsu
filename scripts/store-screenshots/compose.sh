#!/bin/zsh
set -euo pipefail

# ストア用スクリーンショットに、見出し・補足・背景を合成する。
# Singfolio（~/Developer/singfolio）の `scripts/store-screenshots/compose.sh` を元にした（コピー元: singfolio 7cf5272）。
# 変えたところ: 日本語だけ（英語の掲載文は作らない。docs/store-listing.md）、ブランドの色（赤・淡いピンク）、背景に合わせた
# 見出しの色、書体の置き場（このディレクトリの fonts/）、スライドの文言。
#
# 構図: 上に見出し・補足、その下に、角丸の撮影画像（影つき）。撮影画像は下へはみ出させて切る。
#
# 入力: assets/store-screenshots/raw/ja/NN-name.png ... iOSシミュレータの撮影画像（iPhone 18 Pro の 1206×2622）。App Store 用。
#       assets/store-screenshots/raw-android/ja/NN-name.png ... Androidエミュレータの撮影画像（1080×2424）。Google Play 用。
#       どちらも、偽のサーバー（fakeServer.js）の仮名のデータで撮る。画像の大きさは、`magick identify` で読む。
# 出力: assets/store-screenshots/ios/ja/ ... 1206×2622（App Store Connect の iPhone 6.3インチ。**この枠の対応サイズは、1179×2556 と
#         1206×2622 だけ**。提出に使うのは、これ）
#       assets/store-screenshots/ios-large/ja/ ... 1320×2868（6.9インチ。任意。大きい端末の枠に、別に上げたいとき）
#       assets/store-screenshots/play/ja/ ... 1080×1920（Google Play。長辺が短辺の2倍以内。9:16）
# 画像の下部は、iOS はタブバーが全部見える大きさに縮めて、下端を少しはみ出させる。Play は縦が足りないので、はみ出させて切るが、
# 切り口が要素の途中に当たらないよう、余白の帯に合わせて画像の大きさを少し変える（find_cut.py）。
# 見出しは、枠に収まらないとき、文字の大きさを自動で下げる（全スライドで同じ大きさにそろえる）。
asset_dir="${0:A:h}/../../assets/store-screenshots"
asset_dir="${asset_dir:A}"
font_dir="${0:A:h}/fonts"
raw_dir_ios="$asset_dir/raw"
raw_dir_android="$asset_dir/raw-android"
script_dir="${0:A:h}"

# 一時ファイルは、専用のディレクトリに作り、終わったら（途中で止まっても）消す。
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

font_bold="$font_dir/NotoSansJP-Bold.ttf"
font_reg="$font_dir/NotoSansJP-Regular.ttf"

# ブランドの色。赤はアイコンの地（#C8000C。白の文字が約5.9:1）、淡いピンクは、アクセント（#FC75A4。src/theme/colors.ts）を
# 白に約32%混ぜた派生色。白に近い中立色は、白いストアのページで画像の縁が消えるので、背景にしない。
bg_red='#C8000C'
bg_pink='#FFD9E5'
# 背景ごとの文字の色。ピンクの上は濃い色（補足は #52525B で 6:1 以上）、赤の上は白。
headline_on_pink='#17171A'
subhead_on_pink='#52525B'
headline_on_red='#FFFFFF'
subhead_on_red='#FFFFFF'

# 文字の大きさ・余白は、幅1320のときの値。キャンバスの幅に比例させる。
base_w=1320

# 文字列の描画幅（px）。
text_width() {
  local font="$1" size="$2" text="$3"
  magick -font "$font" -pointsize "$size" label:"$text" -format '%w' info:
}

# 枠に収まる最大の文字の大きさ（上限 $2）。複数行のときは、一番長い行で見る。
fit_size() {
  local font="$1" max_size="$2" max_width="$3" text="$4"
  local size="$max_size" widest=0 line w
  while (( size > 20 )); do
    widest=0
    for line in "${(@f)text}"; do
      w=$(text_width "$font" "$size" "$line")
      (( w > widest )) && widest=$w
    done
    (( widest <= max_width )) && break
    size=$(( size - 2 ))
  done
  print -r -- "$size"
}

make_slide() {
  local input="$1" output="$2" canvas_w="$3" canvas_h="$4" headline="$5" subhead="$6" bg="$7" \
    headline_color="$8" sub_color="$9" store="${10}" headline_size="${11}" subhead_size="${12}"
  local unit_num=$canvas_w unit_den=$base_w
  local margin=$(( 90 * unit_num / unit_den ))
  local top=$(( 130 * unit_num / unit_den ))
  local gap=$(( 56 * unit_num / unit_den ))
  local below=$(( 90 * unit_num / unit_den ))
  local shot_w=$(( canvas_w * 906 / 1000 ))
  local corner=$(( 42 * unit_num / unit_den ))

  # 見出しの高さは、描画して測る（行間を含む）。
  local headline_h
  headline_h=$(magick -font "$font_bold" -pointsize "$headline_size" -interline-spacing 14 label:"$headline" -format '%h' info:)
  local subhead_y=$(( top + headline_h + gap ))
  local subhead_h
  subhead_h=$(magick -font "$font_reg" -pointsize "$subhead_size" label:"$subhead" -format '%h' info:)
  local shot_y=$(( subhead_y + subhead_h + below ))

  local in_w in_h
  in_w=$(magick identify -format '%w' "$input")
  in_h=$(magick identify -format '%h' "$input")

  if [[ "$store" == ios* ]]; then
    # タブバーが全部見えるよう、下端に少しはみ出す大きさに縮める（アイコンが半端に切れて見えるのを避ける）。
    local fitted=$(( (canvas_h - shot_y + 36 * unit_num / unit_den) * in_w / in_h ))
    (( fitted < shot_w )) && shot_w=$fitted
  else
    # Play は、キャンバスの下端が、余白の帯に当たるよう、画像の大きさを少し変える
    # （大きすぎる・小さすぎる変更になるときは、そのまま切る）。
    # 影を合成した画像は、影の分だけ上に 32px 広がっている（-shadow 30x25+0+18 の余白。上 32・左右 50）ので、
    # スマホの上端は shot_y より 32px 下になる。
    local room=$(( canvas_h - shot_y - 32 ))
    local visible=$(( room * in_w / shot_w )) cut
    cut=$(python3 "$script_dir/find_cut.py" "$input" "$visible")
    if [[ -n "$cut" ]]; then
      local aligned=$(( room * in_w / cut ))
      (( aligned >= canvas_w * 80 / 100 && aligned <= canvas_w * 95 / 100 )) && shot_w=$aligned
    fi
  fi

  local base="$tmp_dir/base.png" rounded="$tmp_dir/rounded.png" shadowed="$tmp_dir/shadowed.png"

  magick -size ${canvas_w}x${canvas_h} xc:"$bg" \
    -font "$font_bold" -fill "$headline_color" -pointsize "$headline_size" -gravity north \
    -interline-spacing 14 -annotate +0+${top} "$headline" \
    -font "$font_reg" -fill "$sub_color" -pointsize "$subhead_size" -gravity north \
    -annotate +0+${subhead_y} "$subhead" \
    "$base"

  magick "$input" -resize ${shot_w}x \
    \( +clone -alpha extract -draw "fill black polygon 0,0 0,$corner $corner,0 fill white circle $corner,$corner $corner,0" \
       \( +clone -flip \) -compose Multiply -composite \
       \( +clone -flop \) -compose Multiply -composite \
    \) -alpha off -compose CopyOpacity -composite \
    "$rounded"

  magick "$rounded" \( +clone -background black -shadow 30x25+0+18 \) +swap \
    -background none -layers merge +repage \
    "$shadowed"

  magick "$base" "$shadowed" -gravity north -geometry +0+${shot_y} -compose over -composite \
    -crop ${canvas_w}x${canvas_h}+0+0 +repage \
    -strip -colorspace sRGB -alpha off -depth 8 \
    "$output"
}

# 見出し・補足の改行は、文字列の中の \n（読み込みのとき、本物の改行に直す）。見出しは、読点で、2行に折る。
typeset -A headline subhead background
headline[01-home]='iPhoneとAndroidの\n組み合わせでも使える。'
subhead[01-home]='同じアプリで、記録も精算もいっしょに。'
headline[02-shares]='家賃は7:3、\n食費は半分ずつ。'
subhead[02-shares]='費目ごとに、負担割合を決めておけます。'
headline[03-cap]='外食費は月1万円まで、\n自分が負担。'
subhead[03-cap]='上限を超えた分は、決めた割合で分担。'
headline[04-expense]='入力は、\n数タップでかんたん。'
subhead[04-expense]='金額・日付・支払った人・費目を選ぶだけ。'
headline[05-breakdown]='負担額は、\n費目ごとに自動で計算。'
subhead[05-breakdown]='支払額・負担額・差額が、ひと目で分かります。'
headline[06-settle]='精算は、今月でも、\n来月にまとめても。'
subhead[06-settle]='送金ごとに、精算か繰越を選べます。'
headline[07-recurring]='家賃は、\n毎月自動で登録。'
subhead[07-recurring]='固定費は、日付が来ると支出になります。'
background=(
  [01-home]="$bg_red" [02-shares]="$bg_pink" [03-cap]="$bg_red" [04-expense]="$bg_pink"
  [05-breakdown]="$bg_red" [06-settle]="$bg_pink" [07-recurring]="$bg_red"
)
# Google Play だけ、1枚目の見出しを、Androidを先にする（Playの利用者は、Androidの人。iOSの完成品は、iPhoneを先にする）。
headline_play_01='AndroidとiPhoneの\n組み合わせでも使える。'
headline_play_01=${headline_play_01//\\n/$'\n'}
# fit_size は本物の改行で行を分け、ImageMagick は \n を改行とみなす。両方で同じに見えるよう、先に直す。
for key in ${(k)headline}; do
  headline[$key]=${headline[$key]//\\n/$'\n'}
  subhead[$key]=${subhead[$key]//\\n/$'\n'}
done

# 引数があれば、その名前（例: 01-home）だけ作る。
only=("$@")
lang=ja

for store in ios ios-large play; do
  if [[ "$store" == ios ]]; then canvas_w=1206 canvas_h=2622 raw_dir="$raw_dir_ios"
  elif [[ "$store" == ios-large ]]; then canvas_w=1320 canvas_h=2868 raw_dir="$raw_dir_ios"
  else canvas_w=1080 canvas_h=1920 raw_dir="$raw_dir_android"; fi
  mkdir -p "$asset_dir/$store/$lang"

  # このストアで使う見出し（Play だけ、1枚目を差し替える）。
  typeset -A hl
  hl=("${(@kv)headline}")
  [[ "$store" == play ]] && hl[01-home]="$headline_play_01"

  # 見出し・補足の大きさは、全スライドで同じにする（一番長い文言が収まる大きさに合わせる。
  # `only` で一部だけ作るときも、同じ大きさになるよう、全スライドで測る）。
  max_text_w=$(( canvas_w - 2 * (90 * canvas_w / base_w) ))
  h_size=$(( 92 * canvas_w / base_w )) s_size=$(( 46 * canvas_w / base_w ))
  for name in "${(@ko)hl}"; do
    h_size=$(fit_size "$font_bold" "$h_size" "$max_text_w" "${hl[$name]}")
    s_size=$(fit_size "$font_reg" "$s_size" "$max_text_w" "${subhead[$name]}")
  done

  for name in "${(@ko)hl}"; do
    [[ ${#only} -gt 0 && ! " ${only[*]} " == *" $name "* ]] && continue
    input="$raw_dir/$lang/$name.png"
    [[ -f "$input" ]] || { print -u2 "skip (no raw): $input"; continue; }
    if [[ "${background[$name]}" == "$bg_red" ]]; then h_color="$headline_on_red" s_color="$subhead_on_red"
    else h_color="$headline_on_pink" s_color="$subhead_on_pink"; fi
    make_slide "$input" "$asset_dir/$store/$lang/$name.png" "$canvas_w" "$canvas_h" \
      "${hl[$name]}" "${subhead[$name]}" "${background[$name]}" "$h_color" "$s_color" "$store" "$h_size" "$s_size"
    print "$store/$lang/$name.png"
  done
done
