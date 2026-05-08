const samples = {
  monster: [
    "./assets/gallery/monster-01.png",
    "./assets/gallery/monster-02.png",
    "./assets/gallery/monster-03.png",
  ],
  human: [
    "./assets/gallery/human-01.png",
    "./assets/gallery/human-02.png",
    "./assets/gallery/human-03.png",
  ],
  item: [
    "./assets/gallery/item-01.png",
    "./assets/gallery/item-02.png",
    "./assets/gallery/item-03.png",
  ],
  equipment: [
    "./assets/gallery/equipment-01.png",
    "./assets/gallery/equipment-02.png",
    "./assets/gallery/equipment-03.png",
  ],
};

const classSelect = document.querySelector("#class-select");
const seedInput = document.querySelector("#seed-input");
const generateButton = document.querySelector("#generate-button");
const previewImage = document.querySelector("#preview-image");
const previewLabel = document.querySelector("#preview-label");

function hashSeed(value) {
  return Array.from(value).reduce((total, char) => total + char.charCodeAt(0), 0);
}

function updatePreview() {
  const category = classSelect.value;
  const seed = seedInput.value.trim() || "random";
  const options = samples[category];
  const index = hashSeed(`${category}:${seed}:${Date.now()}`) % options.length;
  previewImage.src = options[index];
  previewImage.alt = `Selected ${category} pixel preview`;
  previewLabel.textContent = `${category} / ${seed}`;
}

generateButton.addEventListener("click", updatePreview);
classSelect.addEventListener("change", updatePreview);
