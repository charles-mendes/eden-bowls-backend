// Giant dog breeds of the giant combination matrix (requerimento_energetico.md, "Fatores para raças gigantes"):
// the breeds whose adult weighs over 40 kg. A dog of these breeds gets the giant matrix even at 40 kg or less (a
// female, a lean dog); any dog over 40 kg gets it by weight. Names are normalized (lower case, no accents) and come
// in Portuguese and English, as the store saves the breed in the customer's language.
//
// Sources: every breed of the giant size class of the life-stage table (life_stage_breeds, adult typically above
// ~45 kg), and the large breeds of wp_hsr_breeds whose standard adult weight is above 40 kg: Akita, Bloodhound
// (Sabujo), Kuvasz, Otterhound, Rottweiler, Bulgarian, East European, Karakachan, Kars, Kuchi, Romanian Mioritic and
// Tatra shepherds. Greyhound and Borzoi (25 to 40 kg) are not giants.
const GIANT_BREED_GROUPS = Object.freeze({
  dogue: Object.freeze([
    'akita',
    'aksaray malaklisi',
    'american mastiff',
    'anatolian karabash',
    'anatolian shepherd',
    'bernese mountain dog',
    'black russian terrier',
    'bloodhound',
    'boerboel',
    'boiadeiro de berna',
    'brazilian mastiff',
    'broholmer',
    'bucovina shepherd',
    'bulgarian shepherd dog',
    'bullmastiff',
    'bully kutta',
    'buryat-mongolian wolfhound',
    'cane corso',
    'cao da serra da estrela',
    'cao da serra da estrela (pelo comprido)',
    'cao da serra da estrela (pelo curto)',
    'cao de gado transmontano',
    'cao de guarda de moscou',
    'cao de kars',
    'cao de montanha dos pireneus',
    'cao de sharplanina',
    'cao kuchi',
    'caucasian shepherd',
    'central asian shepherd',
    'deerhound escoces',
    'dogue alemao',
    'dogue de canario',
    'east european shepherd',
    'english mastiff',
    'estrela mountain dog',
    'estrela mountain dog (long hair)',
    'estrela mountain dog (short hair)',
    'fila brasileiro',
    'great dane',
    'great pyrenees',
    'greater swiss mountain dog',
    'hungarian kuvasz',
    'irish wolfhound',
    'kangal',
    'kangal shepherd dog',
    'karabash da anatolia',
    'karakachan',
    'karakachan dog',
    'kars dog',
    'komondor',
    'kuchi dog',
    'kuvasz',
    'kuvasz hungaro',
    'leonberger',
    'lobeiro buriato-mongol',
    'lobeiro irlandes',
    'mastim americano',
    'mastim espanhol',
    'mastim ingles',
    'mastim napolitano',
    'mastim tibetano',
    'moscow watchdog',
    'neapolitan mastiff',
    'otterhound',
    'ovcharka do sul da russia',
    'pastor bulgaro',
    'pastor da anatolia',
    'pastor da asia central',
    'pastor da bucovina',
    'pastor da europa oriental',
    'pastor da russia meridional',
    'pastor de bucovina',
    'pastor de sharplanina',
    'pastor de tatra',
    'pastor do caucaso',
    'pastor mioritic romeno',
    'perro de presa canario',
    'pyrenean mountain dog',
    'rafeiro do alentejo',
    'romanian mioritic shepherd',
    'rottweiler',
    'sabujo',
    'sarplaninac',
    'scottish deerhound',
    'sharplanina dog',
    'sharplanina shepherd',
    'south russian ovcharka',
    'spanish mastiff',
    'tatra shepherd dog',
    'terrier preto russo',
    'tibetan mastiff',
    'tosa inu',
    'transmontano cattle dog'
  ]),
  slow_metabolism: Object.freeze([
    'sao bernardo',
    'sao bernard',
    'saint bernard'
  ]),
  terranova: Object.freeze([
    'terra nova',
    'terranova',
    'newfoundland',
    'landseer'
  ])
});

// Names of the first lists that are not giant breeds (Greyhound, Borzoi) or match no breed of the catalog.
const NOT_GIANT_BREEDS = Object.freeze(['greyhound', 'borzoi', 'anatolian']);

module.exports = {
  GIANT_BREED_GROUPS,
  NOT_GIANT_BREEDS
};
