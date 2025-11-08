const sunIcon = 'img/sun.png'; 
const moonIcon = 'img/moon.png'; 

// Crear botón flotante
const toggleBtn = document.createElement('button');
toggleBtn.id = 'darkModeToggle';

const iconImg = document.createElement('img');
iconImg.style.width = '24px';
iconImg.style.height = '24px';
toggleBtn.appendChild(iconImg);

document.body.appendChild(toggleBtn);

// Aplicar preferencia guardada al cargar
if (localStorage.getItem('theme') === 'dark') {
  document.body.classList.add('dark-mode');
  iconImg.src = sunIcon;
} else {
  iconImg.src = moonIcon;
}

// Función toggle
toggleBtn.addEventListener('click', () => {
  document.body.classList.toggle('dark-mode');
  if (document.body.classList.contains('dark-mode')) {
    iconImg.src = sunIcon;
    localStorage.setItem('theme', 'dark'); // guardar modo
  } else {
    iconImg.src = moonIcon;
    localStorage.setItem('theme', 'light'); // guardar modo
  }
});