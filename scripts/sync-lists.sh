#!/usr/bin/env bash
set -uo pipefail

write="${WRITE_TO_D1:-0}"
mkdir -p lists
failed=()

build() {
  local name="$1" format="$2" version="$3" list_date="$4" min="$5" max="$6"
  node scripts/domain-list.ts --input "lists/${name}.input" --out "lists/${name}.sql" --list "$name" --format "$format" \
    --version "$version" --synced-at "$list_date" --min-entries "$min" --max-entries "$max"
}

store() {
  local name="$1"
  if [[ "$write" == "1" ]]; then
    npx wrangler d1 execute scamcam --remote --env production --file "lists/${name}.sql" --yes > "lists/${name}.log"
  fi
}

github_list() {
  local name="$1" repo="$2" branch="$3" path="$4" format="$5" min="$6" max="$7"
  local sha committed list_date
  sha=$(gh api "repos/${repo}/commits?sha=${branch}&path=${path}&per_page=1" --jq '.[0].sha') || return 1
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "Unexpected commit id for ${name}" >&2; return 1; }
  committed=$(gh api "repos/${repo}/commits/${sha}" --jq .commit.committer.date) || return 1
  list_date=$(date -u -d "$committed" +%s) || return 1
  [[ "$list_date" =~ ^[0-9]{10}$ ]] || { echo "Unexpected commit date for ${name}" >&2; return 1; }
  curl --fail --silent --show-error --location --max-filesize 100000000 \
    "https://raw.githubusercontent.com/${repo}/${sha}/${path}" --output "lists/${name}.input" || return 1
  build "$name" "$format" "${sha:0:12}" "$list_date" "$min" "$max" && store "$name"
}

web_list() {
  local name="$1" url="$2" format="$3" min="$4" max="$5"
  local modified list_date
  curl --fail --silent --show-error --location --max-filesize 100000000 \
    --dump-header "lists/${name}.headers" "$url" --output "lists/${name}.input" || return 1
  modified=$(grep -i '^last-modified:' "lists/${name}.headers" | tail -1 | cut -d' ' -f2- | tr -d '\r')
  list_date=$(date -u -d "${modified:-now}" +%s) || return 1
  [[ "$list_date" =~ ^[0-9]{10}$ ]] || { echo "Unexpected date for ${name}" >&2; return 1; }
  build "$name" "$format" "$(date -u -d "@${list_date}" +%Y%m%d%H%M)" "$list_date" "$min" "$max" && store "$name"
}

ftc_list() {
  local name="$1" days="$2" min="$3" max="$4"
  local newest="" day file list_date
  : > "lists/${name}.input"
  for offset in $(seq 0 "$days"); do
    day=$(date -u -d "-${offset} days" +%Y-%m-%d)
    file="lists/${name}-${day}.csv"
    if curl --fail --silent --location --max-filesize 30000000 --user-agent "ScamCam list sync (+https://scamcam.kevinle.tech)" \
      "https://www.ftc.gov/sites/default/files/DNC_Complaint_Numbers_${day}.csv" --output "$file"; then
      [[ "$(head -c 20 "$file")" == "Company_Phone_Number" ]] || { echo "Unexpected FTC file for ${day}" >&2; return 1; }
      tail -n +2 "$file" | cut -d, -f1 >> "lists/${name}.input"
      newest="${newest:-$day}"
    fi
  done
  [[ -n "$newest" ]] || { echo "No FTC files were found" >&2; return 1; }
  list_date=$(date -u -d "${newest} 16:00" +%s) || return 1
  build "$name" text "ftc-${newest//-/}" "$list_date" "$min" "$max" && store "$name"
}

fcc_list() {
  local name="$1" days="$2" min="$3" max="$4"
  local since modified list_date
  since=$(date -u -d "-${days} days" +%Y-%m-%dT00:00:00) || return 1
  curl --fail --silent --show-error --get --max-filesize 30000000 --user-agent "ScamCam list sync (+https://scamcam.kevinle.tech)" \
    --dump-header "lists/${name}.headers" "https://opendata.fcc.gov/resource/3xyp-aqkj.csv" \
    --data-urlencode '$select=caller_id_number,advertiser_business_phone_number' \
    --data-urlencode "\$where=issue='Unwanted Calls' AND ticket_created >= '${since}'" \
    --data-urlencode '$limit=500000' --output "lists/${name}.csv" || return 1
  [[ "$(head -c 18 "lists/${name}.csv")" == '"caller_id_number"' ]] || { echo "Unexpected FCC file" >&2; return 1; }
  tail -n +2 "lists/${name}.csv" | tr ',' '\n' | tr -d '"' > "lists/${name}.input"
  modified=$(grep -i '^last-modified:' "lists/${name}.headers" | tail -1 | cut -d' ' -f2- | tr -d '\r')
  list_date=$(date -u -d "${modified:-now}" +%s) || return 1
  [[ "$list_date" =~ ^[0-9]{10}$ ]] || { echo "Unexpected date for ${name}" >&2; return 1; }
  build "$name" text "fcc-$(date -u -d "@${list_date}" +%Y%m%d%H%M)" "$list_date" "$min" "$max" && store "$name"
}

run() {
  local name="$1"
  shift
  echo "::group::${name}"
  if "$@"; then
    echo "${name}: done"
  else
    echo "::error::${name} did not sync"
    failed+=("$name")
  fi
  echo "::endgroup::"
}

run phishing_database github_list phishing_database Phishing-Database/Phishing.Database master phishing-domains-ACTIVE.txt text 100000 5000000
run metamask github_list metamask MetaMask/eth-phishing-detect main src/config.json metamask 20000 1000000
run scamsniffer github_list scamsniffer scamsniffer/scam-database main blacklist/domains.json json-array 50000 3000000
run phishdestroy github_list phishdestroy phishdestroy/destroylist main list.txt text 30000 3000000
run scam_links github_list scam_links DevSpen/scam-links master src/links.txt text 2000 200000
run cert_polska web_list cert_polska https://hole.cert.pl/domains/v2/domains.txt text 20000 2000000
run ftc_dnc ftc_list ftc_dnc 30 50000 3000000
run fcc_complaints fcc_list fcc_complaints 90 5000 1000000
run scamsniffer_wallets github_list scamsniffer_wallets scamsniffer/scam-database main blacklist/all.json scamsniffer-addresses 2000 500000

if ((${#failed[@]} > 0)); then
  echo "Lists that did not sync: ${failed[*]}" >&2
  exit 1
fi
