let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1Ijoic21hY29oIiwiYSI6ImNtN2Vid3o1cTBkMzcyam9vdGU1azJydTQifQ.BKGuk0_2OLXtblYT_FbSrA';

// Initialize the map
const map = new mapboxgl.Map({
    container: 'map', // ID of the div where the map will render
    style: 'mapbox://styles/mapbox/streets-v12', // Map style
    center: [-71.09415, 42.36027], // [longitude, latitude]
    zoom: 12, // Initial zoom level
    minZoom: 5, // Minimum allowed zoom
    maxZoom: 18 // Maximum allowed zoom
});

function minutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
}

map.on('load', () => {
    map.addSource('boston_route', {
        type: 'geojson',
        data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson?...'
    });
    map.addLayer({
        id: 'bike-lanes',
        type: 'line',
        source: 'boston_route',
        paint: {
            'line-color': 'green',
            'line-width': 3,
            'line-opacity': 0.4
        }
    });
    map.addSource('cambridge_route', {
        type: 'geojson',
        data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'
    });
    map.addLayer({
        id: 'bike-lanes-cambridge',
        type: 'line',
        source: 'cambridge_route',
        paint: {
            'line-color': 'green',
            'line-width': 3,
            'line-opacity': 0.4
        }
    });

    const svg = d3.select('#map').select('svg');
    let stations = [];
    let trips = [];
    let departures;
    let arrivals;
    let circles;

    let timeFilter = -1;
    const timeSlider = document.getElementById('time-slider');
    const selectedTime = document.getElementById('selected-time');
    const anyTimeLabel = document.getElementById('any-time');

    timeSlider.addEventListener('input', updateTimeDisplay);
    updateTimeDisplay();

    // Load the nested JSON file
    const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json'
    d3.json(jsonurl).then(jsonData => {
        console.log('Loaded JSON Data:', jsonData);  // Log to verify structure
        stations = jsonData.data.stations;
        console.log('Stations Array:', stations);

        const TRIP_DATA_URL = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv'
        //within the map.on('load') which has been previously done
        d3.csv(TRIP_DATA_URL).then(csvData => {
            trips = csvData;
            for (let trip of trips) {

                trip.started_at = new Date(trip.started_at);
                trip.ended_at = new Date(trip.ended_at);
                let startedMinutes = minutesSinceMidnight(trip.started_at);
                departuresByMinute[startedMinutes].push(trip);
                let endedMinutes = minutesSinceMidnight(trip.ended_at);
                arrivalsByMinute[endedMinutes].push(trip);
            }

            departures = d3.rollup(
                trips,
                (v) => v.length,
                (d) => d.start_station_id,
            );
            arrivals = d3.rollup(
                trips,
                (v) => v.length,
                (d) => d.end_station_id,
            );
            stations = stations.map((station) => {
                let id = station.short_name;
                station.arrivals = arrivals.get(id) ?? 0;
                station.departures = departures.get(id) ?? 0;
                station.totalTraffic = station.arrivals + station.departures;
                return station;
            });
            changeCircle(stations);
        }).catch(error => {
            console.error('Error loading CSV:', error);  // Handle errors if CSV loading fails
        });
    }).catch(error => {
        console.error('Error loading JSON:', error);  // Handle errors if JSON loading fails
    });

    // Reposition markers on map interactions
    map.on('move', updatePositions);     // Update during map movement
    map.on('zoom', updatePositions);     // Update during zooming
    map.on('resize', updatePositions);   // Update on window resize
    map.on('moveend', updatePositions);  // Final adjustment after movement ends

    function getCoords(station) {
        const point = new mapboxgl.LngLat(+station.lon, +station.lat);  // Convert lon/lat to Mapbox LngLat
        const { x, y } = map.project(point);  // Project to pixel coordinates
        return { cx: x, cy: y };  // Return as object for use in SVG attributes
    }
    // Function to update circle positions when the map moves/zooms
    function updatePositions() {
        circles
            .attr('cx', d => getCoords(d).cx)  // Set the x-position using projected coordinates
            .attr('cy', d => getCoords(d).cy); // Set the y-position using projected coordinates
    }
    function formatTime(minutes) {
        const date = new Date(0, 0, 0, 0, minutes);  // Set hours & minutes
        return date.toLocaleString('en-US', { timeStyle: 'short' }); // Format as HH:MM AM/PM
    }
    function filterTripsbyTime(time) {
        if (time === -1) {
            return {
                filteredArrivals: arrivals,
                filteredDepartures: departures,
                filteredStations: stations
            };
        }
        const filteredDepartures = d3.rollup(
            filterByMinute(departuresByMinute, timeFilter),
            (v) => v.length,
            (d) => d.start_station_id
        );
        const filteredArrivals = d3.rollup(
            filterByMinute(arrivalsByMinute, timeFilter),
            (v) => v.length,
            (d) => d.end_station_id
        );
        const filteredStations = stations.map(station => {
            let newStation = { ...station };
            let id = newStation.short_name;

            newStation.arrivals = filteredArrivals.get(id) ?? 0;
            newStation.departures = filteredDepartures.get(id) ?? 0;
            newStation.totalTraffic = newStation.arrivals + newStation.departures;
            return newStation;
        });
        return {
            filteredArrivals,
            filteredDepartures,
            filteredStations
        };
    }
    function filterByMinute(tripsByMinute, minute) {
        // Normalize both to the [0, 1439] range
        // % is the remainder operator: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Remainder
        let minMinute = (minute - 60 + 1440) % 1440;
        let maxMinute = (minute + 60) % 1440;

        if (minMinute > maxMinute) {
            let beforeMidnight = tripsByMinute.slice(minMinute);
            let afterMidnight = tripsByMinute.slice(0, maxMinute);
            return beforeMidnight.concat(afterMidnight).flat();
        } else {
            return tripsByMinute.slice(minMinute, maxMinute).flat();
        }
    }
    function updateTimeDisplay() {
        timeFilter = Number(timeSlider.value);  // Get slider value

        if (timeFilter === -1) {
            selectedTime.textContent = '';  // Clear time display
            anyTimeLabel.style.display = 'block';  // Show "(any time)"
        } else {
            selectedTime.textContent = formatTime(timeFilter);  // Display formatted time
            anyTimeLabel.style.display = 'none';  // Hide "(any time)"
        }

        // Trigger filtering logic which will be implemented in the next step
        const {
            filteredArrivals,
            filteredDepartures,
            filteredStations
        } = filterTripsbyTime(timeFilter);
        changeCircle(filteredStations);
    }
    function changeCircle(data) {

        let stationFlow = d3
            .scaleQuantize()
            .domain([0, 1])
            .range([0, 0.5, 1]);

        const radiusScale = d3.scaleSqrt()
            .domain([0, d3.max(data, (d) => d.totalTraffic)])
            .range([0, 20]);

        // Append circles to the SVG for each station
        circles = svg
            .selectAll('circle')
            .data(data, d => d.short_name)
            .join('circle')
            .attr('fill', 'orangered')
            .attr('stroke', 'white')
            .attr('stroke-width', 1)
            .attr('opacity', 0.8)
            .attr('r', d => radiusScale(d.totalTraffic))
            .style("--departure-ratio", d => (d.totalTraffic === 0) ? 0.5 : stationFlow(d.departures / d.totalTraffic))
            .each(function (d) {
                // Add <title> for browser tooltips
                d3.select(this)
                    .append('title')
                    .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
            });
        updatePositions();
    }
});