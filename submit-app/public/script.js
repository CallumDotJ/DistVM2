const form = document.getElementById('submitForm');
const msg = document.getElementById('message');
const typeSelect = document.getElementById('jokeTypeSelect');
const newTypeInput = document.getElementById('newTypeInput');
const newTypeCheckbox = document.getElementById('useNewType');
const newTypeWrapper = document.getElementById('newTypeWrapper');

/* Types Loaders */

//load types into the select menu
async function loadTypes()
{
    const select = typeSelect;

    try{
        const response = await fetch("/submit-api/types") //fetch
        const types = await response.json();

        select.innerHTML = '<option value="">Select a type</option>'; //clear all besides placeholder

        types.types.forEach(type => { // loop and insert options into the select menu
            const option = document.createElement("option");
            option.value = type;
            option.textContent = type;
            select.appendChild(option);
        });
    }
    catch(error)
    {
        console.error("Error loading joke types:", error);
    }
}


form.addEventListener('submit', async (e) => {
    e.preventDefault(); // prevent default form submission

    const setup = document.getElementById("setupInput").value.trim();
    const punchline = document.getElementById("punchlineInput").value.trim();

    // determine type based on checkbox
    const useNewType = newTypeCheckbox.checked; // use new type if checkbox is checked
    const type = useNewType ? newTypeInput.value.trim().toLowerCase() : typeSelect.value.trim().toLowerCase(); 

    // validation of type
    if(useNewType && type.length < 3) { 
        msg.textContent = "new type must be at least 3 characters";
        return;
    }

    if(!setup || !punchline || !type)
    {
        msg.textContent = "please fill in setup, punchline and joke type";
        return;
    }

    // temp test to see data 
    msg.textContent = `OK: ${setup} / ${punchline} / ${type}`;

    // send data to server
    try {
        const response = await fetch('/submit-api/submitQueue', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ setup, punchline, type })
        });
        const result = await response.json();
        msg.textContent = result.message || "submission failed";
    } 
    catch (error) {
        console.error("error submitting joke:", error);
        msg.textContent = "error submitting joke";
    }

});

// Toggle new type input visibility
newTypeCheckbox.addEventListener('change', () => {

    const isChecked = newTypeCheckbox.checked;

    newTypeWrapper.style.display = isChecked ? 'block' : 'none'; 
    newTypeInput.required =  isChecked; // require new type input if using new type

    newTypeInput.value = ''; // clear new type input when toggling

    typeSelect.disabled = isChecked; // disable type select if using new type
    newTypeInput.disabled = !isChecked; // enable new type input if checked
});


// Fetch joke types on page load
window.addEventListener("DOMContentLoaded", async () => {
  await loadTypes();
  typeSelect.addEventListener("focus", loadTypes); // refresh types on user interaction
});
