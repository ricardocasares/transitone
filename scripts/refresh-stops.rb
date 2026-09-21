#!/usr/bin/env ruby
# Development-only: Ruby's CSV parser and the system unzip keep ZIP/CSV code out of the app.
require "csv"
require "json"
require "open3"
require "tmpdir"
require "fileutils"

Dir.mktmpdir("tram-stops-") do |dir|
  zip = ARGV.first || File.join(dir, "trams.zip")
  unless ARGV.first
    system("curl", "--fail", "--silent", "--show-error", "--location", "--max-time", "30",
           "--user-agent", "KrakowTramTones/1.0", "https://gtfs.ztp.krakow.pl/GTFS_KRK_T.zip", "-o", zip) or abort "GTFS download failed"
  end
  csv, status = Open3.capture2("unzip", "-p", zip, "stops.txt")
  abort "Cannot read stops.txt" unless status.success?
  groups = CSV.parse(csv, headers: true).group_by { |row| row.fetch("stop_name").strip }
  mapping = groups.sort.to_h.transform_values { |rows| rows.map { |row| row.fetch("stop_id") }.uniq.sort }
  abort "Invalid or empty stop mapping" if mapping.empty? || mapping.any? { |name, ids| name.empty? || ids.any?(&:empty?) }
  output = ARGV[1] || File.expand_path("../src/data/gtfs-stops.json", __dir__)
  FileUtils.mkdir_p(File.dirname(output))
  File.write(output, JSON.pretty_generate(mapping) + "\n")
  puts "Wrote #{mapping.length} named stops / #{mapping.values.flatten.length} platform IDs to #{output}"
end
