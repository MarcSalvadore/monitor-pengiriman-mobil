-- OSRM Car Profile: Non-Toll Arterial Roads Only (car-nontoll.lua)
-- Excludes all motorway, motorway_link, and toll=yes segments so routes use arterial/non-toll roads.

package.path = "/opt/?.lua;" .. package.path
local car = dofile("/opt/car.lua")

local original_process_way = car.process_way

function car.process_way(profile, way, result, relations)
  local highway = way:get_value_by_key("highway")
  local toll = way:get_value_by_key("toll")

  if toll == "yes" or highway == "motorway" or highway == "motorway_link" then
    return
  end

  return original_process_way(profile, way, result, relations)
end

process_way = car.process_way

return car
